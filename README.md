# Paperless AI Supporter

CLI tool that extracts invoice data from Paperless-ngx documents using LLM and updates custom fields automatically.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure `.env`:
   ```
   PAPERLESS_URL=https://your-paperless-instance.com
   PAPERLESS_API_TOKEN=your-api-token
   ```

3. Configure `config.yaml`:
   - Set custom field IDs (run `npm run dev list-fields` to see available fields)
   - Configure OpenRouter API key and models
   - Adjust tag name and processing options

4. Create prompt files in `prompts/`:
   - `system.txt` - System prompt for LLM
   - `extraction.txt` - Main extraction prompt
   - `custom-rules.txt` (optional) - Additional rules

## Usage

```bash
# Build
npm run build

# Process all documents with configured tag
npm run dev process

# Process single document
npm run dev process -- --id 1234

# Dry run (no changes)
npm run dev dry-run
npm run dev dry-run -- --id 1234

# List custom fields
npm run dev list-fields

# List tags
npm run dev list-tags
```

## Features

- Extracts: invoice number, date, total, vendor, customer (Rechnungsempfänger; optional), VAT rate, net/VAT amounts
- Categorizes invoices (private/business) and assigns tax accounts
- Auto-assigns archive serial number
- Formats document title via `titleFormat` (placeholders: `{{vendor}}`, `{{invoiceNumber}}`, `{{invoiceDate}}`, `{{taxAccount}}`, `{{customer}}`). When you are the vendor (your name in `selfAsCustomer`), `{{vendor}}` shows the customer (recipient) instead of your name. When you are the customer, `{{customer}}` is filled; otherwise it is omitted.
- Adds tags based on category (private or gewerbe/ausgabe/rechnung)
- Vision fallback for documents with poor OCR
- Processing log in `reports/processing.log`

## Tested Models

- **mistral-small** (local via Ollama): Works acceptably for text extraction. Requires well-tuned prompts and custom rules for edge cases (poor OCR, ambiguous vendors). Vision fallback via OpenRouter recommended for missing fields.

## Prompt-Tuning Notes (for small local models like mistral-small)

- **Keyword proximity matters**: Small models associate keywords better when they are close together in the prompt. If a single long list doesn't work, split it into multiple lines with the same category label. Example: two separate `"GWG" = ...` lines work better than one huge line with all keywords.
- **English keywords** sometimes work better than German ones, even for German documents (e.g., "Batteries" instead of "Batterien").
- **Content truncation** (`maxContentLength` in config.yaml) helps a lot - marketing text or cover letters on page 3+ confuse small models. Default is 3500 chars.
- **Retry logic**: If the model says `isInvoice: false` but the text contains invoice indicators (Rechnungs-Nr, Mehrwertsteuer, etc.), a second attempt with full content is made automatically.
- **Custom rules** (`prompts/custom-rules.txt`) are the most reliable way to handle specific vendors or product types that the model consistently misclassifies. These are appended to the prompt and act as explicit overrides.
- **OCR hint** at the top of the extraction prompt reminds the model that text may be garbled and to interpret partial matches.
- **Few-shot example** in the extraction prompt shows the model the expected JSON format - small models benefit significantly from this.

## Docs

- [Hard override rules (plan)](docs/hard-overrides-plan.md) – Natural-language rules translated to executable logic (before/after LLM).

## Requirements

- Node.js 18+
- ImageMagick (for vision fallback PDF conversion)
- OpenRouter API key
