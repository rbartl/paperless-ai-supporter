import axios, { AxiosInstance } from 'axios';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ExtractedInvoiceData, LlmConfig } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '../../prompts');

const DEFAULT_MAX_CONTENT_LENGTH = 10000;

const DEFAULT_PROMPTS: Record<string, string> = {
  'system.txt': `You are an invoice data extraction assistant for Austrian/German accounting.
Extract structured data from invoice documents and return it as JSON.
Always respond with valid JSON only, no extra text.`,

  'extraction.txt': `Extract invoice data from the following document and return JSON.

Document title: {{DOCUMENT_TITLE}}

Document content:
{{DOCUMENT_CONTENT}}

Return a JSON object with exactly these fields:
{
  "isInvoice": true or false,
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "invoiceTotal": number or null,
  "currency": "EUR or other ISO code",
  "vendor": "company or person name or null",
  "customer": "recipient name or null",
  "taxAccount": "accounting code or null (e.g. 3200, 5200, KK)",
  "invoiceCategory": "private" or "gewerbe" or null,
  "ustSatz": number or null,
  "nettoBetrag": number or null,
  "ustBetrag": number or null,
  "vorsteuerIgnorieren": true if VAT/Vorsteuer should be ignored, else false,
  "privatanteil": number (0-100) or null,
  "llmConfidence": 0-100 integer,
  "summary": "one sentence summary or null"
}

Rules:
- invoiceDate must be YYYY-MM-DD format
- All amounts use dot as decimal separator (e.g. 42.50)
- invoiceCategory "gewerbe" = business expense, "private" = personal purchase
- privatanteil: percentage of private (non-business) use. Set to 90 for house/building fees (Hausgebühren, Betriebskosten, Hausverwaltung). Set to 20 for telephone and internet services. Set to null for all other invoices.
- If isInvoice is false, set all other fields to null
- Return ONLY the JSON object, no markdown, no extra text`,

  'vision.txt': `Look at this invoice image and extract the following missing fields:
{{MISSING_FIELDS_LIST}}

Current extracted data (from OCR):
{{CURRENT_DATA_JSON}}

IMPORTANT format rules:
- invoiceDate must be in YYYY-MM-DD format (e.g., "2025-09-03")
- invoiceTotal, nettoBetrag, ustBetrag must be numbers with dot as decimal separator (e.g., 412.18)
- ustSatz must be a string (e.g., "20")

Always set invoiceCategory to either "private" (personal/consumer purchase) or "gewerbe" (business expense).
{{CUSTOM_RULES_SECTION}}

Return ONLY valid JSON with the missing fields filled in where visible, and always include invoiceCategory:
{{JSON_EXAMPLE}}

Use null if a field is not visible in the image.`,
};

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatMessageContent[];
}

interface ChatMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export class LlmClient {
  private textClient: AxiosInstance;
  private visionClient: AxiosInstance;
  private textModel: string;
  private visionModel: string;
  private visionFallback: { enabled: boolean; fields: string[] };
  private maxContentLength: number;
  private systemPrompt: string;
  private extractionPrompt: string;
  private visionPrompt: string;
  private customRules: string | null;

  constructor(config: LlmConfig) {
    this.textModel = config.text.model;
    this.visionModel = config.vision.model;
    this.visionFallback = config.visionFallback;
    this.maxContentLength = config.maxContentLength || DEFAULT_MAX_CONTENT_LENGTH;

    this.textClient = axios.create({
      baseURL: config.text.url,
      headers: {
        Authorization: `Bearer ${config.text.key}`,
        'Content-Type': 'application/json',
      },
      timeout: config.text.timeout,
    });

    this.visionClient = axios.create({
      baseURL: config.vision.url,
      headers: {
        Authorization: `Bearer ${config.vision.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/paperless-ai-supporter',
        'X-Title': 'Paperless AI Supporter',
      },
      timeout: config.vision.timeout,
    });

    this.systemPrompt = this.loadPromptFile('system.txt');
    this.extractionPrompt = this.loadPromptFile('extraction.txt');
    this.visionPrompt = this.loadPromptFile('vision.txt', true);
    this.customRules = this.loadPromptFile('custom-rules.txt', true);
  }

  readonly promptsDir = PROMPTS_DIR;

  private loadPromptFile(filename: string, optional = false): string {
    const filePath = join(PROMPTS_DIR, filename);
    if (!existsSync(filePath)) {
      if (optional) return '';
      const def = DEFAULT_PROMPTS[filename];
      if (def !== undefined) {
        console.warn(`Prompt file not found: ${filePath} — using built-in default`);
        return def;
      }
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    return readFileSync(filePath, 'utf-8').trim();
  }

  getPrompts(): Record<string, string> {
    return {
      system: this.systemPrompt,
      extraction: this.extractionPrompt,
      vision: this.visionPrompt,
      'custom-rules': this.customRules ?? '',
    };
  }

  savePrompt(name: string, content: string): void {
    const allowed = ['system', 'extraction', 'vision', 'custom-rules'];
    if (!allowed.includes(name)) throw new Error(`Unknown prompt: ${name}`);
    mkdirSync(PROMPTS_DIR, { recursive: true });
    writeFileSync(join(PROMPTS_DIR, `${name}.txt`), content, 'utf-8');
    this.reloadPrompts();
  }

  reloadPrompts(): void {
    this.systemPrompt = this.loadPromptFile('system.txt');
    this.extractionPrompt = this.loadPromptFile('extraction.txt');
    this.visionPrompt = this.loadPromptFile('vision.txt', true);
    this.customRules = this.loadPromptFile('custom-rules.txt', true);
  }

  private truncateContent(content: string): string {
    if (this.maxContentLength <= 0 || content.length <= this.maxContentLength) return content;
    const truncated = content.substring(0, this.maxContentLength);
    // Cut at last newline to avoid breaking mid-line
    const lastNewline = truncated.lastIndexOf('\n');
    return (lastNewline > this.maxContentLength * 0.8 ? truncated.substring(0, lastNewline) : truncated)
      + '\n[... truncated]';
  }

  private buildPrompt(documentContent: string, documentTitle?: string, note?: string): string {
    let userPrompt = this.extractionPrompt.replace('{{DOCUMENT_CONTENT}}', documentContent);

    if (documentTitle) {
      userPrompt = userPrompt.replace('{{DOCUMENT_TITLE}}', documentTitle);
    } else {
      userPrompt = userPrompt.replace('Document title: {{DOCUMENT_TITLE}}\n', '');
    }

    if (this.customRules) {
      userPrompt = `${userPrompt}\n\n${this.customRules}`;
    }

    if (note && note.trim()) {
      userPrompt = `${userPrompt}\n\n---\nCRITICAL USER INSTRUCTION (highest priority — overrides all other rules and classifications):\n${note.trim()}\n---`;
    }

    return userPrompt;
  }

  async extractInvoiceData(documentContent: string, documentTitle?: string, retries = 3, note?: string): Promise<ExtractedInvoiceData> {
    // First attempt with truncated content
    const truncatedContent = this.truncateContent(documentContent);
    const result = await this.callTextLlm(truncatedContent, documentTitle, retries, note);

    // If the model said isInvoice: false but the text contains strong invoice indicators, retry with full content
    if (!result.isInvoice && this.hasInvoiceIndicators(documentContent)) {
      console.log(`    Retrying with full content (invoice indicators found in text)...`);
      const retryResult = await this.callTextLlm(documentContent, documentTitle, retries, note);
      if (retryResult.isInvoice) {
        return retryResult;
      }
    }

    return result;
  }

  private hasInvoiceIndicators(content: string): boolean {
    const indicators = [
      /rechnungs[_\s-]*nr/i,
      /rechnungsnummer/i,
      /rechnung\s+nr/i,
      /total\s+in\s+eur/i,
      /gesamtbetrag/i,
      /mehrwertsteuer/i,
      /bruttobetrag/i,
      /nettobetrag/i,
      /vertragsrechnung/i,
    ];
    return indicators.some(pattern => pattern.test(content));
  }

  private async callTextLlm(documentContent: string, documentTitle?: string, retries = 3, note?: string): Promise<ExtractedInvoiceData> {
    const userPrompt = this.buildPrompt(documentContent, documentTitle, note);

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    if (process.env.DEBUG) {
      console.log(`\n${'─'.repeat(60)}\n    LLM SYSTEM PROMPT:\n${'─'.repeat(60)}\n${this.systemPrompt}\n`);
      console.log(`${'─'.repeat(60)}\n    LLM USER PROMPT:\n${'─'.repeat(60)}\n${userPrompt}\n${'─'.repeat(60)}`);
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const isOllama = this.textClient.defaults.baseURL?.includes('localhost') || this.textClient.defaults.baseURL?.includes('127.0.0.1');
        const response = await this.textClient.post<ChatCompletionResponse>(
          '/chat/completions',
          {
            model: this.textModel,
            messages,
            temperature: 0.1,
            max_tokens: 5000,
            ...(isOllama ? { options: { num_ctx: 16384 } } : {}),
          }
        );

        const content = response.data.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response content from LLM');
        }

        try {
          const compacted = JSON.stringify(JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content));
          console.log(`    LLM raw: ${compacted}`);
        } catch {
          console.log(`    LLM raw: ${content.replace(/\n\s*/g, ' ')}`);
        }
        return this.parseResponse(content);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          console.log(`    Attempt ${attempt} failed: ${lastError.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError;
  }

  /** Treat null, undefined, empty/whitespace string (and NaN for numbers) as missing for vision fallback. */
  private isFieldValueEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (typeof value === 'number') return Number.isNaN(value);
    return false;
  }

  /** Seed for vision-only extraction (e.g. document with no OCR text). */
  getEmptyExtractionSeed(): ExtractedInvoiceData {
    return {
      isInvoice: true,
      invoiceNumber: null,
      invoiceDate: null,
      invoiceTotal: null,
      currency: null,
      vendor: null,
      customer: null,
      taxAccount: null,
      invoiceCategory: null,
      ustSatz: null,
      nettoBetrag: null,
      ustBetrag: null,
      vorsteuerIgnorieren: null,
      privatanteil: null,
      llmConfidence: null,
      summary: null,
    };
  }

  needsVisionFallback(data: ExtractedInvoiceData): boolean {
    if (!this.visionFallback.enabled || !data.isInvoice) return false;

    for (const field of this.visionFallback.fields) {
      const value = data[field as keyof ExtractedInvoiceData];
      if (this.isFieldValueEmpty(value)) {
        return true;
      }
    }
    return false;
  }

  async extractWithVision(
    image: { buffer: Buffer; mimeType: string },
    currentData: ExtractedInvoiceData,
    retries = 2,
    note?: string
  ): Promise<ExtractedInvoiceData> {
    const missingFields = this.visionFallback.fields.filter((f) =>
      this.isFieldValueEmpty(currentData[f as keyof ExtractedInvoiceData])
    );

    const base64Image = image.buffer.toString('base64');
    const mimeType = image.mimeType;

    const customRulesSection = this.customRules
      ? `\nUser rules for category (apply when they fit):\n${this.customRules}`
      : '';
    const criticalNoteSection = note && note.trim()
      ? `\n\n---\nCRITICAL USER INSTRUCTION (highest priority — overrides all other rules and classifications):\n${note.trim()}\n---`
      : '';
    const jsonExample = `{\n  ${missingFields.map((f) => `"${f}": "..."`).join(',\n  ')},\n  "invoiceCategory": "private" or "gewerbe"\n}`;

    const prompt = this.visionPrompt
      ? this.visionPrompt
          .replace('{{MISSING_FIELDS_LIST}}', missingFields.map((f) => `- ${f}`).join('\n'))
          .replace('{{CURRENT_DATA_JSON}}', JSON.stringify(currentData, null, 2))
          .replace('{{CUSTOM_RULES_SECTION}}', customRulesSection)
          .replace('{{JSON_EXAMPLE}}', jsonExample)
          + criticalNoteSection
      : `Look at this invoice image and extract the following missing fields:
${missingFields.map((f) => `- ${f}`).join('\n')}

Current extracted data (from OCR):
${JSON.stringify(currentData, null, 2)}

IMPORTANT format rules:
- invoiceDate must be in YYYY-MM-DD format (e.g., "2025-09-03")
- invoiceTotal, nettoBetrag, ustBetrag must be numbers with dot as decimal separator (e.g., 412.18)
- ustSatz must be a string (e.g., "20")

Always set invoiceCategory to either "private" (personal/consumer purchase) or "gewerbe" (business expense). Use the vendor and the items on the invoice to decide (e.g. office supplies → gewerbe, personal care/hygiene → private). If vendor or product type suggests one category more than the other, prefer that; if truly ambiguous, choose based on what seems more likely.
${customRulesSection}

Return ONLY valid JSON with the missing fields filled in where visible, and always include invoiceCategory:
${jsonExample}

Use null if a field is not visible in the image.${criticalNoteSection}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: 'text', text: prompt },
        ],
      },
    ];

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.visionClient.post<ChatCompletionResponse>(
          '/chat/completions',
          {
            model: this.visionModel,
            messages,
            temperature: 0.1,
            max_tokens: 5000,
          }
        );

        const content = response.data.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response content from vision model');
        }

        try {
          const compacted = JSON.stringify(JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content));
          console.log(`    Vision raw: ${compacted}`);
        } catch {
          console.log(`    Vision raw: ${content.replace(/\n\s*/g, ' ')}`);
        }

        const visionData = this.parseVisionResponse(content);

        // Merge vision data into current data
        return {
          ...currentData,
          ...Object.fromEntries(
            Object.entries(visionData).filter(([_, v]) => v !== null)
          ),
        } as ExtractedInvoiceData;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          console.log(`    Vision attempt ${attempt} failed: ${lastError.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    console.log(`    Vision fallback failed: ${lastError?.message}`);
    return currentData;
  }

  private parseVisionResponse(content: string): Partial<ExtractedInvoiceData> {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {};
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return this.normalizeExtractedValues(parsed);
    } catch {
      return {};
    }
  }

  /**
   * Normalize a numeric value from the LLM. Handles: number, string with comma decimal, array (takes highest for rates, sums for amounts).
   */
  private normalizeNumeric(value: unknown, mode: 'highest' | 'sum' = 'sum'): number | null {
    if (value == null) return null;
    if (Array.isArray(value)) {
      const nums = value
        .map(v => typeof v === 'object' && v !== null
          ? Number(String((v as Record<string, unknown>).rate ?? (v as Record<string, unknown>).amount ?? (v as Record<string, unknown>).betrag ?? Object.values(v)[0]).replace(',', '.'))
          : Number(String(v).replace(',', '.')))
        .filter(n => !isNaN(n));
      if (nums.length === 0) return null;
      return mode === 'highest' ? Math.max(...nums) : nums.reduce((a, b) => a + b, 0);
    }
    const num = Number(String(value).replace(',', '.'));
    return isNaN(num) ? null : num;
  }

  private normalizeExtractedValues(data: Record<string, unknown>): Partial<ExtractedInvoiceData> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        result[key] = null;
        continue;
      }

      // Normalize numeric fields: handle comma decimals and string numbers
      if (['invoiceTotal', 'nettoBetrag', 'ustBetrag', 'privatanteil', 'llmConfidence'].includes(key)) {
        const str = String(value).replace(',', '.');
        const num = Number(str);
        result[key] = isNaN(num) ? null : num;
        continue;
      }

      // Normalize date: convert DD.MM.YYYY to YYYY-MM-DD
      if (key === 'invoiceDate' && typeof value === 'string') {
        const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (match) {
          result[key] = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
          continue;
        }
      }

      // Only accept valid invoiceCategory
      if (key === 'invoiceCategory') {
        result[key] = value === 'private' || value === 'gewerbe' ? value : null;
        continue;
      }

      result[key] = value;
    }

    return result as Partial<ExtractedInvoiceData>;
  }

  private validateVendor(vendor: string | null): string | null {
    if (!vendor || vendor.trim().length <= 3) return null;
    return vendor;
  }

  private parseResponse(content: string): ExtractedInvoiceData {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in LLM response: ${content.substring(0, 200)}`);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const isInvoice = parsed.isInvoice === true;
      const invoiceCategory = isInvoice ? (parsed.invoiceCategory === 'private' || parsed.invoiceCategory === 'gewerbe' ? parsed.invoiceCategory : null) : null;

      // Normalize values from the text model too
      const normalized = this.normalizeExtractedValues(parsed);

      const result: ExtractedInvoiceData = {
        isInvoice,
        invoiceNumber: isInvoice ? (parsed.invoiceNumber ?? null) : null,
        invoiceDate: isInvoice ? (normalized.invoiceDate as string ?? parsed.invoiceDate ?? null) : null,
        invoiceTotal: isInvoice && parsed.invoiceTotal !== undefined ? Number(String(parsed.invoiceTotal).replace(',', '.')) || null : null,
        currency: isInvoice ? (parsed.currency ?? 'EUR') : null,
        vendor: isInvoice ? this.validateVendor(parsed.vendor ?? null) : null,
        customer: isInvoice && parsed.customer != null ? String(parsed.customer).trim() || null : null,
        taxAccount: isInvoice ? (parsed.taxAccount ?? null) : null,
        invoiceCategory,
        ustSatz: isInvoice ? this.normalizeNumeric(parsed.ustSatz, 'highest') : null,
        nettoBetrag: isInvoice && parsed.nettoBetrag !== undefined ? Number(String(parsed.nettoBetrag).replace(',', '.')) || null : null,
        ustBetrag: isInvoice ? this.normalizeNumeric(parsed.ustBetrag, 'sum') : null,
        vorsteuerIgnorieren: isInvoice ? parsed.vorsteuerIgnorieren === true : null,
        privatanteil: isInvoice && parsed.privatanteil !== undefined && parsed.privatanteil !== null ? Number(parsed.privatanteil) || null : null,
        llmConfidence: parsed.llmConfidence !== undefined ? Number(parsed.llmConfidence) : null,
        summary: typeof parsed.summary === 'string' ? parsed.summary.substring(0, 150) : null,
      };

      return result;
    } catch (error) {
      throw new Error(`Failed to parse LLM response as JSON: ${content}`);
    }
  }
}
