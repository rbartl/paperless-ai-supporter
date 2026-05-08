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

  async processDocument(documentId: number, dryRun = false): Promise<ProcessingResult> {
    try {
      const document = await this.paperless.getDocument(documentId);
      console.log(`\nProcessing document ${documentId}: "${document.title}"`);

      const content = document.content;
      if (!content || content.trim().length === 0) {
        return {
          documentId,
          title: document.title,
          success: false,
          error: 'Document has no text content',
        };
      }

      console.log(`  Extracting data using LLM...`);
      let extractedData = await this.llm.extractInvoiceData(content, document.title);
      console.log(`  Extracted:`, extractedData);

      // Vision fallback if enabled and fields are missing
      if (extractedData.isInvoice && this.llm.needsVisionFallback(extractedData)) {
        console.log(`  Trying vision fallback for missing fields...`);
        try {
          const preview = await this.paperless.getDocumentPreview(documentId);
          extractedData = await this.llm.extractWithVision(preview, extractedData);
          console.log(`  After vision:`, extractedData);
        } catch (error) {
          console.log(`  Vision fallback error: ${error instanceof Error ? error.message : error}`);
        }
      }

      if (!extractedData.isInvoice) {
        console.log(`  Skipped: Not an invoice`);
        if (!dryRun) {
          // Set summary even for non-invoice documents
          if (this.customFields.aisummary !== null && extractedData.summary) {
            const summaryFields = this.buildSummaryPayload(extractedData.summary, document.custom_fields);
            await this.paperless.updateDocumentCustomFields(documentId, summaryFields);
            console.log(`  Set AI summary: "${extractedData.summary}"`);
          }
          if (this.config.paperless.removeTagAfterProcessing) {
            await this.paperless.removeTagFromDocument(documentId, this.config.paperless.tag);
            console.log(`  Removed tag "${this.config.paperless.tag}"`);
          }
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
        console.log(`  [DRY RUN] Would update custom fields`);
        if (newTitle) {
          console.log(`  [DRY RUN] Would set title to: "${newTitle}"`);
        }
        if (categoryTags.length > 0) {
          console.log(`  [DRY RUN] Would add tags: ${categoryTags.join(', ')}`);
        }
        if (this.config.paperless.setIssueDate && extractedData.invoiceDate) {
          console.log(`  [DRY RUN] Would set issue date to: ${extractedData.invoiceDate}`);
        }
        if (this.config.paperless.setArchiveSerialNumber && document.archive_serial_number === null) {
          const nextAsn = await this.paperless.getNextArchiveSerialNumber();
          console.log(`  [DRY RUN] Would set archive serial number to: ${nextAsn}`);
        }
        const isStatement = extractedData.taxAccount === 'KK';
        const documentTypeId = isStatement
          ? this.config.paperless.statementDocumentType
          : this.config.paperless.invoiceDocumentType;
        if (documentTypeId !== null) {
          console.log(`  [DRY RUN] Would set document type to: ${isStatement ? 'Kontoauszug' : 'Rechnung'} (${documentTypeId})`);
        }
        return {
          documentId,
          title: document.title,
          success: true,
          extractedData,
        };
      }

      const customFields = this.buildCustomFieldsPayload(extractedData, document.custom_fields, document.title);
      await this.paperless.updateDocumentCustomFields(documentId, customFields);
      console.log(`  Updated custom fields`);

      if (newTitle) {
        await this.paperless.updateDocumentTitle(documentId, newTitle);
        console.log(`  Updated title to: "${newTitle}"`);
      }

      if (categoryTags.length > 0) {
        await this.paperless.addTagsToDocument(documentId, categoryTags);
        console.log(`  Added tags: ${categoryTags.join(', ')}`);
      }

      if (this.config.paperless.setIssueDate && extractedData.invoiceDate) {
        await this.paperless.updateDocumentCreatedDate(documentId, extractedData.invoiceDate);
        console.log(`  Set issue date to: ${extractedData.invoiceDate}`);
      }

      if (this.config.paperless.setArchiveSerialNumber && document.archive_serial_number === null) {
        const nextAsn = await this.paperless.getNextArchiveSerialNumber();
        await this.paperless.setArchiveSerialNumber(documentId, nextAsn);
        console.log(`  Set archive serial number to: ${nextAsn}`);
      }

      // Set document type based on taxAccount
      const isStatement = extractedData.taxAccount === 'KK';
      const documentTypeId = isStatement
        ? this.config.paperless.statementDocumentType
        : this.config.paperless.invoiceDocumentType;
      if (documentTypeId !== null) {
        await this.paperless.setDocumentType(documentId, documentTypeId);
        console.log(`  Set document type to: ${isStatement ? 'Kontoauszug' : 'Rechnung'}`);
      }

      if (this.config.paperless.removeTagAfterProcessing) {
        await this.paperless.removeTagFromDocument(documentId, this.config.paperless.tag);
        console.log(`  Removed tag "${this.config.paperless.tag}"`);
      }

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

  private buildCustomFieldsPayload(
    extractedData: ExtractedInvoiceData,
    existingFields: CustomFieldValue[],
    documentTitle: string
  ): CustomFieldValue[] {
    const fieldMap = new Map<number, string | number | null>();

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
    // bookingDate is left empty for manual entry

    return Array.from(fieldMap.entries()).map(([field, value]) => ({
      field,
      value,
    }));
  }

  private buildSummaryPayload(
    summary: string,
    existingFields: CustomFieldValue[]
  ): CustomFieldValue[] {
    const fieldMap = new Map<number, string | number | null>();
    for (const field of existingFields) {
      fieldMap.set(field.field, field.value);
    }
    fieldMap.set(this.customFields.aisummary!, summary);
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

    const vendor = (data.vendor || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]/g, '')
      .substring(0, 20);
    const invoiceNumber = (data.invoiceNumber || 'unknown')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .substring(0, 30);
    const invoiceDate = data.invoiceDate ? data.invoiceDate.replace(/-/g, '') : '';
    const taxAccount = data.taxAccount || '';

    let title = format
      .replace('{{vendor}}', vendor)
      .replace('{{invoiceNumber}}', invoiceNumber)
      .replace('{{invoiceDate}}', invoiceDate)
      .replace('{{taxAccount}}', taxAccount);

    // Clean up empty placeholders and trailing underscores/dashes
    title = title.replace(/_+$/, '').replace(/-+$/, '');

    return title;
  }

  printSummary(results: ProcessingResult[], dryRun = false): void {
    console.log('\n' + '='.repeat(50));
    console.log('Processing Summary');
    console.log('='.repeat(50));

    const successful = results.filter((r) => r.success && !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const failed = results.filter((r) => !r.success);

    console.log(`Total: ${results.length}`);
    console.log(`Processed: ${successful.length}`);
    console.log(`Skipped (not invoices): ${skipped.length}`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length > 0) {
      console.log('\nFailed documents:');
      for (const result of failed) {
        console.log(`  - ${result.documentId}: ${result.title}`);
        console.log(`    Error: ${result.error}`);
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
        lines.push(`timestamp=${timestamp},status=OK,type=invoice,docId=${r.documentId},llmConfidence=${d.llmConfidence || ''},oldTitle="${r.title}",newTitle="${r.newTitle || ''}",category=${d.invoiceCategory || ''},vendor="${d.vendor || ''}",invoiceNumber="${d.invoiceNumber || ''}",date=${d.invoiceDate || ''},total=${d.invoiceTotal || ''},netto=${d.nettoBetrag || ''},ust=${d.ustBetrag || ''},ustSatz=${d.ustSatz || ''},currency=${d.currency || 'EUR'},taxAccount=${d.taxAccount || ''}`);
      }
    }

    // Append to log file
    const content = lines.join('\n') + '\n';
    appendFileSync(filepath, content);
    console.log(`\nLog appended to: ${filepath}`);
  }
}
