/**
 * Regression test: re-runs extraction for all documents from processing.log
 * and compares results with the last known-good extraction.
 *
 * Usage: npx tsx scripts/regression-test.ts [--fix-log]
 *   --fix-log   Only clean up processing.log (keep latest per docId), don't run tests
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, loadEnvConfig } from '../src/config.js';
import { PaperlessClient } from '../src/clients/paperless.js';
import { LlmClient } from '../src/clients/llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, '../reports/processing.log');

interface LogEntry {
  docId: number;
  status: string;
  type: string;
  category: string;
  vendor: string;
  invoiceNumber: string;
  date: string;
  total: string;
  netto: string;
  ust: string;
  ustSatz: string;
  currency: string;
  taxAccount: string;
  llmConfidence: string;
  title: string;
  raw: string;
}

function parseLine(line: string): LogEntry | null {
  // Skip old format lines (line 1) and empty lines
  if (!line.startsWith('timestamp=') || !line.includes('docId=')) return null;

  const get = (key: string): string => {
    // Handle quoted values: key="value with, commas"
    const quotedMatch = line.match(new RegExp(`${key}="([^"]*)"`));
    if (quotedMatch) return quotedMatch[1];
    // Handle unquoted values: key=value (up to next comma-key= or end)
    const match = line.match(new RegExp(`${key}=([^,]*?)(?:,[a-zA-Z]+=|$)`));
    return match ? match[1] : '';
  };

  const docId = parseInt(get('docId'));
  if (isNaN(docId)) return null;

  return {
    docId,
    status: get('status'),
    type: get('type'),
    category: get('category'),
    vendor: get('vendor'),
    invoiceNumber: get('invoiceNumber'),
    date: get('date'),
    total: get('total'),
    netto: get('netto'),
    ust: get('ust'),
    ustSatz: get('ustSatz'),
    currency: get('currency'),
    taxAccount: get('taxAccount'),
    llmConfidence: get('llmConfidence'),
    title: get('title') || get('oldTitle') || '',
    raw: line,
  };
}

function cleanLog(): Map<number, LogEntry> {
  const lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n');
  const latest = new Map<number, LogEntry>();

  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      latest.set(entry.docId, entry); // last one wins
    }
  }

  return latest;
}

function writeCleanLog(entries: Map<number, LogEntry>): void {
  const lines = Array.from(entries.values()).map(e => e.raw);
  writeFileSync(LOG_PATH, lines.join('\n') + '\n');
  console.log(`Cleaned log: ${lines.length} unique entries written to ${LOG_PATH}`);
}

async function main() {
  const fixLogOnly = process.argv.includes('--fix-log');

  // Step 1: Clean up log
  console.log('Parsing processing.log...');
  const entries = cleanLog();
  const okEntries = Array.from(entries.values()).filter(e => e.status === 'OK');
  const skippedEntries = Array.from(entries.values()).filter(e => e.status === 'SKIPPED');
  console.log(`Found ${entries.size} unique documents (${okEntries.length} OK, ${skippedEntries.length} SKIPPED)`);

  if (fixLogOnly) {
    writeCleanLog(entries);
    return;
  }

  // Step 2: Run dry-run for each OK document and compare
  const config = loadConfig();
  const envConfig = loadEnvConfig();
  const paperless = new PaperlessClient(envConfig);
  const llm = new LlmClient(config.llm);

  const compareFields = ['vendor', 'invoiceNumber', 'date', 'total', 'netto', 'ust', 'ustSatz', 'currency', 'taxAccount', 'category'];

  const report: string[] = [];
  report.push('# Regression Test Report');
  report.push(`Date: ${new Date().toISOString()}`);
  report.push(`Model: ${config.llm.text.model}`);
  report.push(`Documents tested: ${okEntries.length}`);
  report.push('');

  let passed = 0;
  let failed = 0;
  let errors = 0;
  const diffs: { docId: number; field: string; expected: string; got: string }[] = [];

  for (const expected of okEntries) {
    process.stdout.write(`  Testing doc ${expected.docId}...`);

    try {
      const doc = await paperless.getDocument(expected.docId);
      const content = await paperless.getDocumentContent(expected.docId);
      const result = await llm.extractInvoiceData(content, doc.title);

      // Map extracted result to log-comparable fields
      const got: Record<string, string> = {
        vendor: result.vendor || '',
        invoiceNumber: result.invoiceNumber || '',
        date: result.invoiceDate || '',
        total: result.invoiceTotal != null ? String(result.invoiceTotal) : '',
        netto: result.nettoBetrag != null ? String(result.nettoBetrag) : '',
        ust: result.ustBetrag != null ? String(result.ustBetrag) : '',
        ustSatz: result.ustSatz != null ? String(result.ustSatz) : '',
        currency: result.currency || 'EUR',
        taxAccount: result.taxAccount || '',
        category: result.invoiceCategory || '',
      };

      const docDiffs: string[] = [];
      for (const field of compareFields) {
        const exp = (expected as any)[field] || '';
        const actual = got[field] || '';
        // Normalize for comparison: lowercase, trim
        if (exp.toLowerCase().trim() !== actual.toLowerCase().trim()) {
          docDiffs.push(`${field}: "${exp}" → "${actual}"`);
          diffs.push({ docId: expected.docId, field, expected: exp, got: actual });
        }
      }

      if (docDiffs.length === 0) {
        passed++;
        console.log(' OK');
      } else {
        failed++;
        console.log(` DIFF: ${docDiffs.join(' | ')}`);
        report.push(`## Doc ${expected.docId} - DIFF`);
        report.push(`Vendor: ${expected.vendor}`);
        for (const d of docDiffs) {
          report.push(`  - ${d}`);
        }
        report.push('');
      }
    } catch (error: any) {
      errors++;
      console.log(` ERROR: ${error.message}`);
      report.push(`## Doc ${expected.docId} - ERROR`);
      report.push(`  ${error.message}`);
      report.push('');
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} diffs, ${errors} errors (${okEntries.length} total)`);
  console.log(`${'═'.repeat(60)}`);

  if (diffs.length > 0) {
    console.log('\nDifferences:');
    for (const d of diffs) {
      console.log(`  Doc ${d.docId}: ${d.field} expected="${d.expected}" got="${d.got}"`);
    }
  }

  report.push('## Summary');
  report.push(`- Passed: ${passed}`);
  report.push(`- Diffs: ${failed}`);
  report.push(`- Errors: ${errors}`);
  report.push(`- Total: ${okEntries.length}`);

  const reportPath = join(__dirname, '../reports/regression-test.md');
  writeFileSync(reportPath, report.join('\n'));
  console.log(`\nReport written to: ${reportPath}`);
}

main().catch(console.error);
