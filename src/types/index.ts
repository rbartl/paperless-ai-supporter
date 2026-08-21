export interface WebConfig {
  dbPath: string;
  port?: number;
}

export interface Config {
  paperless: PaperlessConfig;
  customFields: CustomFieldsConfig;
  llm: LlmConfig;
  web?: WebConfig;
}

export interface DbProcessingResult {
  id: number;
  document_id: number;
  document_title: string;
  new_title: string | null;
  processed_at: string;
  success: number;
  skipped: number;
  dry_run: number;
  error_message: string | null;
  extracted_json: string | null;
  llm_model: string | null;
  note: string | null;
}

export interface PaperlessConfig {
  tag: string;
  removeTagAfterProcessing: boolean;
  setArchiveSerialNumber: boolean;
  setIssueDate: boolean;
  updateTitle: boolean;
  titleFormat: string;
  /** Your names (case-insensitive). When extracted customer matches → {{customer}} in titleFormat is filled. When you are the vendor → {{vendor}} in titleFormat shows the customer (recipient) instead of your name. E.g. ["edvbartl", "EDV Bartl"]. */
  selfAsCustomer?: string[];
  reportPath: string | null;
  invoiceDocumentType: number | null;
  statementDocumentType: number | null;
  /** Paperless tag names applied per invoiceCategory. Reprocessing removes the other category's tags. */
  categoryTags?: {
    private?: string[];
    gewerbe?: string[];
  };
}

export interface CustomFieldsConfig {
  invoiceNumber: string | null;
  bookingDate: string | null;
  invoiceDate: string | null;
  invoiceTotal: string | null;
  vendor: string | null;
  customer: string | null;
  taxAccount: string | null;
  ustSatz: string | null;
  nettoBetrag: string | null;
  ustBetrag: string | null;
  vorsteuerIgnorieren: string | null;
  vorsteuerSperre: string | null;
  privatanteil: string | null;
  llmConfidence: string | null;
  originalTitle: string | null;
  aisummary: string | null;
  userComment: string | null;
}

export interface ResolvedCustomFields {
  invoiceNumber: number | null;
  bookingDate: number | null;
  invoiceDate: number | null;
  invoiceTotal: number | null;
  vendor: number | null;
  customer: number | null;
  taxAccount: number | null;
  ustSatz: number | null;
  nettoBetrag: number | null;
  ustBetrag: number | null;
  vorsteuerIgnorieren: number | null;
  vorsteuerSperre: number | null;
  privatanteil: number | null;
  llmConfidence: number | null;
  originalTitle: number | null;
  aisummary: number | null;
  userComment: number | null;
}

export interface LlmEndpointConfig {
  url: string;
  key: string;
  model: string;
  timeout: number;
}

export interface LlmConfig {
  text: LlmEndpointConfig;
  vision: LlmEndpointConfig;
  maxContentLength: number;
  visionFallback: {
    enabled: boolean;
    fields: string[];
  };
}

export interface EnvConfig {
  paperlessUrl: string;
  paperlessPublicUrl: string;
  paperlessApiToken: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface PaperlessDocument {
  id: number;
  title: string;
  content: string;
  tags: number[];
  custom_fields: CustomFieldValue[];
  created: string;
  added: string;
  correspondent: number | null;
  archive_serial_number: number | null;
}

export interface CustomFieldValue {
  field: number;
  value: string | number | boolean | null;
}

export interface PaperlessCustomField {
  id: number;
  name: string;
  data_type: string;
}

export interface PaperlessTag {
  id: number;
  name: string;
}

export interface PaperlessListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ExtractedInvoiceData {
  isInvoice: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
  currency: string | null;
  vendor: string | null;
  /** Recipient/customer name (Rechnungsempfänger). Optional; null if not on document. */
  customer: string | null;
  taxAccount: string | null;
  invoiceCategory: 'private' | 'gewerbe' | null;
  ustSatz: number | null;
  nettoBetrag: number | null;
  ustBetrag: number | null;
  vorsteuerIgnorieren: boolean | null;
  vorsteuerSperre: boolean | null;
  privatanteil: number | null;
  llmConfidence: number | null;
  summary: string | null;
}

export interface ProcessingResult {
  documentId: number;
  title: string;
  newTitle?: string;
  success: boolean;
  extractedData?: ExtractedInvoiceData;
  error?: string;
  skipped?: boolean;
}
