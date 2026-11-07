import axios, { AxiosInstance } from 'axios';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describeErrors } from './http-errors.js';
import {
  EnvConfig,
  PaperlessDocument,
  PaperlessCustomField,
  PaperlessTag,
  PaperlessListResponse,
  CustomFieldValue,
  CustomFieldsConfig,
  ResolvedCustomFields,
} from '../types/index.js';

export interface DocumentPatch {
  custom_fields?: CustomFieldValue[];
  title?: string;
  tags?: number[];
  created?: string;
  archive_serial_number?: number;
  document_type?: number;
}

export class PaperlessClient {
  private client: AxiosInstance;

  constructor(envConfig: EnvConfig) {
    const headers: Record<string, string> = {
      Authorization: `Token ${envConfig.paperlessApiToken}`,
      'Content-Type': 'application/json',
    };

    if (envConfig.cfAccessClientId && envConfig.cfAccessClientSecret) {
      headers['CF-Access-Client-Id'] = envConfig.cfAccessClientId;
      headers['CF-Access-Client-Secret'] = envConfig.cfAccessClientSecret;
    }

    this.client = axios.create({
      baseURL: envConfig.paperlessUrl,
      headers,
      timeout: 30000,
    });
    describeErrors(this.client, 'Paperless');
  }

  /** Fetch every page of a list endpoint (Paperless pages by 25 by default). */
  private async getAll<T>(url: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const results: T[] = [];
    for (let page = 1; ; page++) {
      const response = await this.client.get<PaperlessListResponse<T>>(url, {
        params: { ...params, page, page_size: 100 },
      });
      if (!Array.isArray(response.data?.results)) {
        throw new Error(
          `Unexpected response from GET ${url} — expected {results:[...]}, got: ${JSON.stringify(response.data)?.slice(0, 200)}`
        );
      }
      results.push(...response.data.results);
      if (!response.data.next) return results;
    }
  }

  async getDocumentsByTag(tagName: string): Promise<PaperlessDocument[]> {
    return this.getAll<PaperlessDocument>('/api/documents/', { tags__name__iexact: tagName });
  }

  async getDocument(id: number): Promise<PaperlessDocument> {
    const response = await this.client.get<PaperlessDocument>(`/api/documents/${id}/`);
    return response.data;
  }

  async getDocumentContent(id: number): Promise<string> {
    const document = await this.getDocument(id);
    return document.content || '';
  }

  /** Apply all changes in one PATCH — each PATCH is a full (expensive) document save in Paperless. */
  async updateDocument(id: number, patch: DocumentPatch): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, patch);
  }

  async getNextArchiveSerialNumber(): Promise<number> {
    const response = await this.client.get<number>('/api/documents/next_asn/');
    return response.data;
  }

  async getDocumentPreview(id: number): Promise<{ buffer: Buffer; mimeType: string }> {
    // Get the PDF preview
    const response = await this.client.get(`/api/documents/${id}/preview/`, {
      responseType: 'arraybuffer',
    });
    const pdfBuffer = Buffer.from(response.data);

    // Use ImageMagick to convert PDF to PNG (better compatibility)
    const tempPdf = join(tmpdir(), `paperless_${id}_${Date.now()}.pdf`);
    const tempPng = join(tmpdir(), `paperless_${id}_${Date.now()}.png`);

    try {
      writeFileSync(tempPdf, pdfBuffer);
      // Convert first page with 200 DPI for good quality
      try {
        execSync(`magick -density 200 "${tempPdf}[0]" -quality 90 "${tempPng}"`, {
          timeout: 30000,
        });
      } catch (err) {
        const timedOut = (err as NodeJS.ErrnoException).code === 'ETIMEDOUT';
        throw new Error(`PDF→PNG conversion (ImageMagick) for document #${id} ${timedOut ? 'took longer than 30s' : `failed: ${err instanceof Error ? err.message : err}`}`);
      }
      const pngBuffer = readFileSync(tempPng);
      return { buffer: pngBuffer, mimeType: 'image/png' };
    } finally {
      try { unlinkSync(tempPdf); } catch {}
      try { unlinkSync(tempPng); } catch {}
    }
  }

  async getCustomFields(): Promise<PaperlessCustomField[]> {
    return this.getAll<PaperlessCustomField>('/api/custom_fields/');
  }

  async resolveCustomFields(config: CustomFieldsConfig): Promise<ResolvedCustomFields> {
    const fields = await this.getCustomFields();
    const fieldMap = new Map(fields.map(f => [f.name.toLowerCase(), f.id]));

    const resolve = (name: string | null): number | null => {
      if (!name) return null;
      const id = fieldMap.get(name.toLowerCase());
      if (id === undefined) {
        console.warn(`  Warning: Custom field "${name}" not found in Paperless`);
        return null;
      }
      return id;
    };

    return {
      invoiceNumber: resolve(config.invoiceNumber),
      bookingDate: resolve(config.bookingDate),
      invoiceDate: resolve(config.invoiceDate),
      invoiceTotal: resolve(config.invoiceTotal),
      vendor: resolve(config.vendor),
      customer: resolve(config.customer),
      taxAccount: resolve(config.taxAccount),
      ustSatz: resolve(config.ustSatz),
      nettoBetrag: resolve(config.nettoBetrag),
      ustBetrag: resolve(config.ustBetrag),
      vorsteuerIgnorieren: resolve(config.vorsteuerIgnorieren),
      vorsteuerSperre: resolve(config.vorsteuerSperre),
      privatanteil: resolve(config.privatanteil),
      llmConfidence: resolve(config.llmConfidence),
      originalTitle: resolve(config.originalTitle),
      aisummary: resolve(config.aisummary),
      userComment: resolve(config.userComment),
    };
  }

  async getTags(): Promise<PaperlessTag[]> {
    return this.getAll<PaperlessTag>('/api/tags/');
  }
}
