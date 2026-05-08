import axios, { AxiosInstance } from 'axios';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
    });
  }

  async getDocumentsByTag(tagName: string): Promise<PaperlessDocument[]> {
    const response = await this.client.get<PaperlessListResponse<PaperlessDocument>>(
      '/api/documents/',
      {
        params: {
          tags__name__iexact: tagName,
        },
      }
    );
    return response.data.results;
  }

  async getDocument(id: number): Promise<PaperlessDocument> {
    const response = await this.client.get<PaperlessDocument>(`/api/documents/${id}/`);
    return response.data;
  }

  async getDocumentContent(id: number): Promise<string> {
    const document = await this.getDocument(id);
    return document.content || '';
  }

  async updateDocumentCustomFields(
    id: number,
    customFields: CustomFieldValue[]
  ): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, {
      custom_fields: customFields,
    });
  }

  async getNextArchiveSerialNumber(): Promise<number> {
    const response = await this.client.get<number>('/api/documents/next_asn/');
    return response.data;
  }

  async setArchiveSerialNumber(id: number, asn: number): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, {
      archive_serial_number: asn,
    });
  }

  async updateDocumentCreatedDate(id: number, date: string): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, {
      created: date,
    });
  }

  async updateDocumentTitle(id: number, title: string): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, {
      title,
    });
  }

  async setDocumentType(id: number, documentTypeId: number): Promise<void> {
    await this.client.patch(`/api/documents/${id}/`, {
      document_type: documentTypeId,
    });
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
      execSync(`magick -density 200 "${tempPdf}[0]" -quality 90 "${tempPng}"`, {
        timeout: 30000,
      });
      const pngBuffer = readFileSync(tempPng);
      return { buffer: pngBuffer, mimeType: 'image/png' };
    } finally {
      try { unlinkSync(tempPdf); } catch {}
      try { unlinkSync(tempPng); } catch {}
    }
  }

  async removeTagFromDocument(documentId: number, tagName: string): Promise<void> {
    const document = await this.getDocument(documentId);
    const tags = await this.getTags();
    const tagToRemove = tags.find(
      (t) => t.name.toLowerCase() === tagName.toLowerCase()
    );

    if (tagToRemove) {
      const updatedTags = document.tags.filter((t) => t !== tagToRemove.id);
      await this.client.patch(`/api/documents/${documentId}/`, {
        tags: updatedTags,
      });
    }
  }

  async addTagsToDocument(documentId: number, tagNames: string[]): Promise<void> {
    const document = await this.getDocument(documentId);
    const allTags = await this.getTags();
    const currentTags = new Set(document.tags);

    for (const tagName of tagNames) {
      const tag = allTags.find(
        (t) => t.name.toLowerCase() === tagName.toLowerCase()
      );
      if (tag) {
        currentTags.add(tag.id);
      }
    }

    await this.client.patch(`/api/documents/${documentId}/`, {
      tags: Array.from(currentTags),
    });
  }

  async getCustomFields(): Promise<PaperlessCustomField[]> {
    const response = await this.client.get<PaperlessListResponse<PaperlessCustomField>>(
      '/api/custom_fields/'
    );
    if (!Array.isArray(response.data?.results)) {
      throw new Error(
        `Unexpected response from GET /api/custom_fields/ — expected {results:[...]}, got: ${JSON.stringify(response.data)?.slice(0, 200)}`
      );
    }
    return response.data.results;
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
      llmConfidence: resolve(config.llmConfidence),
      originalTitle: resolve(config.originalTitle),
      aisummary: resolve(config.aisummary),
    };
  }

  async getTags(): Promise<PaperlessTag[]> {
    const response = await this.client.get<PaperlessListResponse<PaperlessTag>>(
      '/api/tags/'
    );
    return response.data.results;
  }
}
