import { PaperlessClient } from '../clients/paperless.js';
import { LlmClient } from '../clients/llm.js';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  Config,
  CustomFieldValue,
  ExtractedInvoiceData,
  ProcessingResult,
  ResolvedCustomFields,
} from '../types/index.js';

const LOW_CONFIDENCE_NON_INVOICE_THRESHOLD = 50;

export class InvoiceProcessor {
  constructor(
    private paperless: PaperlessClient,
    private llm: LlmClient,
    private config: Config,
    private customFields: ResolvedCustomFields
  ) {}

  async processAllTaggedDocuments(dryRun = false, limit?: number): Promise<ProcessingResult[]> {
    const allDocuments = await this.paperless.getDocumentsByTag(this.config.paperless.tag);
    const documents = limit ? allDocuments.slice(0, limit) : allDocuments;

    console.log(`Found ${allDocuments.length} document(s) with tag "${this.config.paperless.tag}"${limit ? `, processing ${documents.length}` : ''}`);

    const results: ProcessingResult[] = [];

    for (const doc of documents) {
      const result = await this.processDocument(doc.id, dryRun);
      results.push(result);
    }

    return results;
  }

  async processDocument(documentId: number, dryRun = false, note?: string): Promise<ProcessingResult> {
    try {
      const document = await this.paperless.getDocument(documentId);
      console.log(`\nProcessing document ${documentId}: "${document.title}"`);

      // note: explicit value from the caller always wins (and overwrites the stored
      // comment below); when absent (e.g. batch processing) fall back to whatever
      // comment is already persisted on the document, so reprocessing stays deterministic.
      const storedComment = this.getStoredComment(document.custom_fields);
      const effectiveNote = note !== undefined ? note : (storedComment ?? undefined);
      if (effectiveNote && effectiveNote.trim()) {
        console.log(`  Note: ${effectiveNote.trim()}`);
      }

      const content = document.content;
      const hasNoText = !content || content.trim().length === 0;

      let extractedData: ExtractedInvoiceData;

      if (hasNoText) {
        if (!this.llm.needsVisionFallback(this.llm.getEmptyExtractionSeed())) {
          return {
            documentId,
            title: document.title,
            success: false,
            error: 'Document has no text content',
          };
        }
        console.log(`  No text content, using vision fallback...`);
        try {
          const preview = await this.paperless.getDocumentPreview(documentId);
          extractedData = await this.llm.extractWithVision(preview, this.llm.getEmptyExtractionSeed(), 2, effectiveNote);
          console.log(`  → vision(no-text): vendor:${extractedData.vendor || '?'} | nr:${extractedData.invoiceNumber || '?'} | date:${extractedData.invoiceDate || '?'} | total:${extractedData.currency || 'EUR'} ${extractedData.invoiceTotal ?? '?'} | konto:${extractedData.taxAccount || '?'} | category:${extractedData.invoiceCategory || '?'}`);
        } catch (error) {
          console.log(`  Vision (no-text) error: ${error instanceof Error ? error.message : error}`);
          return {
            documentId,
            title: document.title,
            success: false,
            error: `Document has no text content; vision fallback failed: ${error instanceof Error ? error.message : error}`,
          };
        }
      } else {
        extractedData = await this.llm.extractInvoiceData(content, document.title, 3, effectiveNote);
        console.log(`  → vendor:${extractedData.vendor || '?'} | nr:${extractedData.invoiceNumber || '?'} | date:${extractedData.invoiceDate || '?'} | total:${extractedData.currency || 'EUR'} ${extractedData.invoiceTotal ?? '?'} | konto:${extractedData.taxAccount || '?'} | category:${extractedData.invoiceCategory || '?'} | conf:${extractedData.llmConfidence ?? '?'}%`);
      }

      // Vision fallback if enabled and fields are missing
      if (extractedData.isInvoice && this.llm.needsVisionFallback(extractedData)) {
        console.log(`  Vision fallback...`);
        try {
          const preview = await this.paperless.getDocumentPreview(documentId);
          extractedData = await this.llm.extractWithVision(preview, extractedData, 2, effectiveNote);
          console.log(`  → vision: vendor:${extractedData.vendor || '?'} | nr:${extractedData.invoiceNumber || '?'} | date:${extractedData.invoiceDate || '?'} | total:${extractedData.currency || 'EUR'} ${extractedData.invoiceTotal ?? '?'} | konto:${extractedData.taxAccount || '?'} | category:${extractedData.invoiceCategory || '?'}`);
        } catch (error) {
          console.log(`  Vision error: ${error instanceof Error ? error.message : error}`);
        }
      }

      // Low-confidence non-invoice: give vision a chance to recover obvious invoices
      if (
        !extractedData.isInvoice &&
        extractedData.llmConfidence !== null &&
        extractedData.llmConfidence < LOW_CONFIDENCE_NON_INVOICE_THRESHOLD
      ) {
        console.log(`  Low confidence non-invoice (conf=${extractedData.llmConfidence}%), trying vision fallback...`);
        try {
          const preview = await this.paperless.getDocumentPreview(documentId);
          const visionSeed: ExtractedInvoiceData = { ...extractedData, isInvoice: true };
          extractedData = await this.llm.extractWithVision(preview, visionSeed, 2, effectiveNote);
          console.log(`  → vision(low-conf): vendor:${extractedData.vendor || '?'} | nr:${extractedData.invoiceNumber || '?'} | date:${extractedData.invoiceDate || '?'} | total:${extractedData.currency || 'EUR'} ${extractedData.invoiceTotal ?? '?'} | konto:${extractedData.taxAccount || '?'} | category:${extractedData.invoiceCategory || '?'}`);

          // If vision filled at least vendor and total, treat as invoice
          if (!extractedData.isInvoice && extractedData.vendor && extractedData.invoiceTotal != null) {
            extractedData.isInvoice = true;
            console.log('  → treating as invoice based on vision result (vendor + total present)');
          }
        } catch (error) {
          console.log(`  Vision (low-conf) error: ${error instanceof Error ? error.message : error}`);
        }
      }

      if (!extractedData.isInvoice) {
        if (!dryRun) {
          const skipActions: string[] = ['skip:not-invoice'];
          // Set summary even for non-invoice documents
          const hasSummary = this.customFields.aisummary !== null && !!extractedData.summary;
          const hasCommentUpdate = this.customFields.userComment !== null && note !== undefined;
          if (hasSummary || hasCommentUpdate) {
            const summaryFields = this.buildSummaryPayload(extractedData.summary, document.custom_fields, note);
            await this.paperless.updateDocumentCustomFields(documentId, summaryFields);
            if (hasSummary) skipActions.push(`summary="${extractedData.summary}"`);
            if (hasCommentUpdate) skipActions.push(`comment updated`);
          }
          if (this.config.paperless.removeTagAfterProcessing) {
            await this.paperless.removeTagFromDocument(documentId, this.config.paperless.tag);
            skipActions.push(`-tag:${this.config.paperless.tag}`);
          }
          console.log(`  ${skipActions.join(', ')}`);
        } else {
          console.log(`  skip:not-invoice`);
        }
        return {
          documentId,
          title: document.title,
          success: true,
          extractedData,
          skipped: true,
        };
      }

      const newTitle = this.config.paperless.updateTitle
        ? this.formatTitle(extractedData)
        : null;

      const categoryTags = this.getCategoryTags(extractedData.invoiceCategory);

      if (dryRun) {
        const dryActions: string[] = ['fields'];
        if (newTitle) dryActions.push(`title="${newTitle}"`);
        if (categoryTags.length > 0) dryActions.push(`tags=[${categoryTags.join(',')}]`);
        if (this.config.paperless.setIssueDate && extractedData.invoiceDate) {
          dryActions.push(`issueDate=${extractedData.invoiceDate}`);
        }
        if (this.config.paperless.setArchiveSerialNumber && document.archive_serial_number === null) {
          const nextAsn = await this.paperless.getNextArchiveSerialNumber();
          dryActions.push(`ASN=${nextAsn}`);
        }
        const isStatement = extractedData.taxAccount === 'KK';
        const documentTypeId = isStatement
          ? this.config.paperless.statementDocumentType
          : this.config.paperless.invoiceDocumentType;
        if (documentTypeId !== null) {
          dryActions.push(`type=${isStatement ? 'Kontoauszug' : 'Rechnung'}`);
        }
        console.log(`  [DRY RUN] Would: ${dryActions.join(', ')}`);
        return {
          documentId,
          title: document.title,
          success: true,
          extractedData,
        };
      }

      const customFields = this.buildCustomFieldsPayload(extractedData, document.custom_fields, document.title, note);
      await this.paperless.updateDocumentCustomFields(documentId, customFields);

      const actions: string[] = ['fields'];

      if (newTitle) {
        await this.paperless.updateDocumentTitle(documentId, newTitle);
        actions.push(`title="${newTitle}"`);
      }

      if (categoryTags.length > 0) {
        await this.paperless.addTagsToDocument(documentId, categoryTags);
        actions.push(`tags=[${categoryTags.join(',')}]`);
      }

      if (this.config.paperless.setIssueDate && extractedData.invoiceDate) {
        await this.paperless.updateDocumentCreatedDate(documentId, extractedData.invoiceDate);
        actions.push(`issueDate=${extractedData.invoiceDate}`);
      }

      if (this.config.paperless.setArchiveSerialNumber && document.archive_serial_number === null) {
        const nextAsn = await this.paperless.getNextArchiveSerialNumber();
        await this.paperless.setArchiveSerialNumber(documentId, nextAsn);
        actions.push(`ASN=${nextAsn}`);
      }

      // Set document type based on taxAccount
      const isStatement = extractedData.taxAccount === 'KK';
      const documentTypeId = isStatement
        ? this.config.paperless.statementDocumentType
        : this.config.paperless.invoiceDocumentType;
      if (documentTypeId !== null) {
        await this.paperless.setDocumentType(documentId, documentTypeId);
        actions.push(`type=${isStatement ? 'Kontoauszug' : 'Rechnung'}`);
      }

      if (this.config.paperless.removeTagAfterProcessing) {
        await this.paperless.removeTagFromDocument(documentId, this.config.paperless.tag);
        actions.push(`-tag:${this.config.paperless.tag}`);
      }

      console.log(`  Updated: ${actions.join(', ')}`);

      return {
        documentId,
        title: document.title,
        newTitle: newTitle || undefined,
        success: true,
        extractedData,
      };
    } catch (error: any) {
      const responseData = error?.response?.data ? JSON.stringify(error.response.data) : '';
      const errorMessage = (error instanceof Error ? error.message : String(error))
        + (responseData ? ` | Response: ${responseData}` : '');
      console.error(`  Error: ${errorMessage}`);
      return {
        documentId,
        title: `Document ${documentId}`,
        success: false,
        error: errorMessage,
      };
    }
  }

  private getStoredComment(existingFields: CustomFieldValue[]): string | null {
    if (this.customFields.userComment === null) return null;
    const entry = existingFields.find((f) => f.field === this.customFields.userComment);
    return typeof entry?.value === 'string' && entry.value.trim() ? entry.value : null;
  }

  private buildCustomFieldsPayload(
    extractedData: ExtractedInvoiceData,
    existingFields: CustomFieldValue[],
    documentTitle: string,
    explicitNote?: string
  ): CustomFieldValue[] {
    const fieldMap = new Map<number, string | number | boolean | null>();

    // Preserve existing field values
    for (const field of existingFields) {
      fieldMap.set(field.field, field.value);
    }

    // Update with extracted data (only if field is configured)
    const cf = this.customFields;

    if (cf.invoiceNumber !== null && extractedData.invoiceNumber !== null) {
      fieldMap.set(cf.invoiceNumber, extractedData.invoiceNumber);
    }
    if (cf.invoiceDate !== null && extractedData.invoiceDate !== null) {
      fieldMap.set(cf.invoiceDate, extractedData.invoiceDate);
    }
    if (cf.invoiceTotal !== null && extractedData.invoiceTotal !== null) {
      // Format: "EUR45.38" for Paperless monetary fields
      const currency = extractedData.currency || 'EUR';
      const monetaryValue = `${currency}${Number(extractedData.invoiceTotal).toFixed(2)}`;
      fieldMap.set(cf.invoiceTotal, monetaryValue);
    }
    if (cf.vendor !== null && extractedData.vendor !== null) {
      fieldMap.set(cf.vendor, extractedData.vendor);
    }
    if (cf.customer !== null && extractedData.customer !== null) {
      fieldMap.set(cf.customer, extractedData.customer);
    }
    if (cf.taxAccount !== null && extractedData.taxAccount !== null) {
      fieldMap.set(cf.taxAccount, extractedData.taxAccount);
    }
    if (cf.ustSatz !== null && extractedData.ustSatz !== null) {
      fieldMap.set(cf.ustSatz, String(extractedData.ustSatz));
    }
    if (cf.nettoBetrag !== null && extractedData.nettoBetrag !== null) {
      const currency = extractedData.currency || 'EUR';
      const monetaryValue = `${currency}${Number(extractedData.nettoBetrag).toFixed(2)}`;
      fieldMap.set(cf.nettoBetrag, monetaryValue);
    }
    if (cf.ustBetrag !== null && extractedData.ustBetrag !== null) {
      const currency = extractedData.currency || 'EUR';
      const monetaryValue = `${currency}${Number(extractedData.ustBetrag).toFixed(2)}`;
      fieldMap.set(cf.ustBetrag, monetaryValue);
    }
    if (cf.vorsteuerIgnorieren !== null && extractedData.vorsteuerIgnorieren !== null) {
      fieldMap.set(cf.vorsteuerIgnorieren, extractedData.vorsteuerIgnorieren);
    }
    if (cf.vorsteuerSperre !== null && extractedData.vorsteuerSperre !== null) {
      fieldMap.set(cf.vorsteuerSperre, extractedData.vorsteuerSperre);
    }
    if (cf.privatanteil !== null && extractedData.privatanteil !== null) {
      fieldMap.set(cf.privatanteil, String(extractedData.privatanteil));
    }
    if (cf.llmConfidence !== null && extractedData.llmConfidence !== null) {
      fieldMap.set(cf.llmConfidence, String(extractedData.llmConfidence));
    }
    // Save original title only if field is configured and currently empty
    if (cf.originalTitle !== null) {
      const currentValue = fieldMap.get(cf.originalTitle);
      if (!currentValue) {
        fieldMap.set(cf.originalTitle, documentTitle);
      }
    }
    if (cf.aisummary !== null && extractedData.summary !== null) {
      fieldMap.set(cf.aisummary, extractedData.summary);
    }
    // An explicitly submitted note (even empty, meaning "cleared") overwrites the
    // stored comment; when no note was submitted the stored value is left untouched.
    if (cf.userComment !== null && explicitNote !== undefined) {
      const trimmed = explicitNote.trim();
      fieldMap.set(cf.userComment, trimmed.length > 0 ? trimmed : null);
    }
    // bookingDate is left empty for manual entry

    return Array.from(fieldMap.entries()).map(([field, value]) => ({
      field,
      value,
    }));
  }

  private buildSummaryPayload(
    summary: string | null,
    existingFields: CustomFieldValue[],
    explicitNote?: string
  ): CustomFieldValue[] {
    const fieldMap = new Map<number, string | number | boolean | null>();
    for (const field of existingFields) {
      fieldMap.set(field.field, field.value);
    }
    if (this.customFields.aisummary !== null && summary) {
      fieldMap.set(this.customFields.aisummary, summary);
    }
    if (this.customFields.userComment !== null && explicitNote !== undefined) {
      const trimmed = explicitNote.trim();
      fieldMap.set(this.customFields.userComment, trimmed.length > 0 ? trimmed : null);
    }
    return Array.from(fieldMap.entries()).map(([field, value]) => ({ field, value }));
  }

  private getCategoryTags(category: 'private' | 'gewerbe' | null): string[] {
    if (category === 'private') {
      return ['private'];
    } else if (category === 'gewerbe') {
      return ['gewerbe', 'ausgabe', 'rechnung'];
    }
    return [];
  }

  private formatTitle(data: ExtractedInvoiceData): string | null {
    const format = this.config.paperless.titleFormat;
    const selfAsCustomer = this.config.paperless.selfAsCustomer ?? [];

    // When we are the vendor (outgoing invoice), show customer in place of vendor in the title
    const isSelfAsVendor =
      data.vendor != null &&
      data.vendor.trim() !== '' &&
      selfAsCustomer.some((self) => data.vendor!.trim().toLowerCase() === self.trim().toLowerCase());
    const vendorSource = isSelfAsVendor ? (data.customer || 'unknown') : (data.vendor || 'unknown');
    const vendor = vendorSource
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]/g, '')
      .substring(0, 20);
    const invoiceNumber = (data.invoiceNumber || 'unknown')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .substring(0, 30);
    const invoiceDate = data.invoiceDate ? data.invoiceDate.replace(/-/g, '') : '';
    const taxAccount = data.taxAccount || '';

    const isSelfAsCustomer =
      data.customer != null &&
      data.customer.trim() !== '' &&
      selfAsCustomer.some(
        (self) => data.customer!.trim().toLowerCase() === self.trim().toLowerCase()
      );
    const customer =
      isSelfAsCustomer && data.customer
        ? data.customer
            .toLowerCase()
            .replace(/[^a-z0-9äöüß]/g, '')
            .substring(0, 20)
        : '';

    let title = format
      .replace('{{vendor}}', vendor)
      .replace('{{invoiceNumber}}', invoiceNumber)
      .replace('{{invoiceDate}}', invoiceDate)
      .replace('{{taxAccount}}', taxAccount)
      .replace('{{customer}}', customer);

    // Clean up empty placeholders: collapse repeated separators, then trim trailing
    title = title
      .replace(/_+/g, '_')
      .replace(/-+/g, '-')
      .replace(/_+$/, '')
      .replace(/-+$/, '');

    return title;
  }

  printSummary(results: ProcessingResult[], dryRun = false): void {
    const successful = results.filter((r) => r.success && !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => !r.success);

    console.log(`\n--- ${results.length} total: ${successful.length} processed, ${skipped.length} skipped, ${failed.length} failed ---`);

    if (failed.length > 0) {
      for (const result of failed) {
        console.log(`  FAIL #${result.documentId} "${result.title}": ${result.error}`);
      }
    }

    // Write log if configured
    if (this.config.paperless.reportPath && !dryRun) {
      this.writeReport(results);
    }
  }

  private writeReport(results: ProcessingResult[]): void {
    const reportPath = this.config.paperless.reportPath!;

    if (!existsSync(reportPath)) {
      mkdirSync(reportPath, { recursive: true });
    }

    const filepath = join(reportPath, 'processing.log');
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const lines: string[] = [];
    for (const r of results) {
      if (r.skipped) {
        lines.push(`timestamp=${timestamp},status=SKIPPED,type=unknown,docId=${r.documentId},title="${r.title}"`);
      } else if (!r.success) {
        lines.push(`timestamp=${timestamp},status=FAILED,type=invoice,docId=${r.documentId},title="${r.title}",error="${r.error}"`);
      } else {
        const d = r.extractedData!;
        lines.push(`timestamp=${timestamp},status=OK,type=invoice,docId=${r.documentId},llmConfidence=${d.llmConfidence || ''},oldTitle="${r.title}",newTitle="${r.newTitle || ''}",category=${d.invoiceCategory || ''},vendor="${d.vendor || ''}",invoiceNumber="${d.invoiceNumber || ''}",date=${d.invoiceDate || ''},total=${d.invoiceTotal || ''},netto=${d.nettoBetrag || ''},ust=${d.ustBetrag || ''},ustSatz=${d.ustSatz || ''},privatanteil=${d.privatanteil ?? ''},currency=${d.currency || 'EUR'},taxAccount=${d.taxAccount || ''}`);
      }
    }

    // Append to log file
    const content = lines.join('\n') + '\n';
    appendFileSync(filepath, content);
    console.log(`\nLog appended to: ${filepath}`);
  }
}
