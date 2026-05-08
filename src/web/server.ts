import express, { Response } from 'express';
import { Config, EnvConfig } from '../types/index.js';
import { PaperlessClient } from '../clients/paperless.js';
import { LlmClient } from '../clients/llm.js';
import { InvoiceProcessor } from '../services/invoice-processor.js';
import { ResultRepository } from '../db/repository.js';
import * as views from './views.js';

// ── Log broadcaster: intercepts console during processing, streams to SSE clients ──

class LogBroadcaster {
  private clients = new Set<Response>();

  addClient(res: Response): void {
    this.clients.add(res);
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
  }

  private emit(line: string, level: 'info' | 'error'): void {
    const payload = `data: ${JSON.stringify({ line, level })}\n\n`;
    for (const client of this.clients) {
      try { client.write(payload); } catch {}
    }
  }

  // Runs fn() with console.log/error intercepted and forwarded to SSE clients.
  async capture<T>(fn: () => Promise<T>): Promise<T> {
    const origLog = console.log;
    const origError = console.error;
    const fmt = (...args: unknown[]) =>
      args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

    console.log = (...args: unknown[]) => { origLog(...args); this.emit(fmt(...args), 'info'); };
    console.error = (...args: unknown[]) => { origError(...args); this.emit(fmt(...args), 'error'); };
    try {
      return await fn();
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  }
}

// ── Server ──────────────────────────────────────────────────────────────────────

export async function startWebServer(
  config: Config,
  envConfig: EnvConfig
): Promise<void> {
  const port = config.web?.port ?? 3000;
  const dbPath = config.web!.dbPath;
  const paperlessUrl = envConfig.paperlessUrl;

  console.log(`Connecting to Paperless at ${paperlessUrl}`);
  console.log(`LLM model: ${config.llm.text.model}`);
  console.log(`Database: ${dbPath}`);

  const paperless = new PaperlessClient(envConfig);
  const llm = new LlmClient(config.llm);
  console.log('Resolving custom fields...');
  const resolvedFields = await paperless.resolveCustomFields(config.customFields);
  const processor = new InvoiceProcessor(paperless, llm, config, resolvedFields);
  const repo = new ResultRepository(dbPath);
  const broadcaster = new LogBroadcaster();
  console.log('Initialisation complete.');

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const ts = new Date().toISOString();
      console.log(`${ts}  ${req.method} ${req.path}  ${res.statusCode}  ${ms}ms`);
    });
    next();
  });

  // ── SSE log stream ───────────────────────────────────────────────────────────

  app.get('/api/log-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    broadcaster.addClient(res);
    req.on('close', () => broadcaster.removeClient(res));
  });

  // ── Results list (main page) ─────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    const rows = repo.findAll();
    const stats = repo.getStats();
    res.send(views.resultsPage(rows, stats, paperlessUrl));
  });

  // ── Stats fragment for htmx auto-refresh ────────────────────────────────────

  app.get('/api/stats', (_req, res) => {
    res.send(views.statsCards(repo.getStats()));
  });

  // ── Result detail ────────────────────────────────────────────────────────────

  app.get('/results/:id', (req, res) => {
    const row = repo.findById(parseInt(req.params.id, 10));
    if (!row) {
      res.status(404).send(views.errorPage('Ergebnis nicht gefunden.'));
      return;
    }
    res.send(views.detailPage(row, paperlessUrl));
  });

  // ── Retry a result ───────────────────────────────────────────────────────────

  app.post('/results/:id/retry', async (req, res) => {
    const existing = repo.findById(parseInt(req.params.id, 10));
    if (!existing) {
      res.status(404).send('<tr><td colspan="9" class="text-danger">Not found.</td></tr>');
      return;
    }
    try {
      console.log(`[retry] document #${existing.document_id} "${existing.document_title}" (result #${existing.id})`);
      const result = await broadcaster.capture(() =>
        processor.processDocument(existing.document_id, false)
      );
      const saved = repo.save(result, false, config.llm.text.model);
      console.log(`[retry] done → result #${saved.id}, success=${!!result.success}, skipped=${!!result.skipped}`);
      const hxTarget = req.headers['hx-target'] as string | undefined;
      if (hxTarget === 'result-row-detail') {
        res.send(
          `<div class="alert alert-success mt-2" role="alert">
            Reprocessed. <a href="/results/${saved.id}">View result #${saved.id}</a>
          </div>`
        );
      } else {
        res.send(views.resultRow(saved, paperlessUrl));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[retry] error for document #${existing.document_id}: ${msg}`);
      res.status(500).send(
        `<tr><td colspan="9" class="text-danger p-2"><code>${msg}</code></td></tr>`
      );
    }
  });

  // ── Queue (documents with processing tag) ────────────────────────────────────

  app.get('/queue', async (_req, res) => {
    try {
      const docs = await paperless.getDocumentsByTag(config.paperless.tag);
      console.log(`[queue] ${docs.length} document(s) with tag "${config.paperless.tag}"`);
      res.send(views.queuePage(docs, config.paperless.tag, paperlessUrl));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[queue] Paperless error: ${msg}`);
      res.send(views.errorPage(`Paperless error: ${msg}`));
    }
  });

  // ── Process a single document from the queue ─────────────────────────────────

  app.post('/queue/:docId/process', async (req, res) => {
    const docId = parseInt(req.params.docId, 10);
    try {
      console.log(`[queue] processing document #${docId}`);
      const result = await broadcaster.capture(() =>
        processor.processDocument(docId, false)
      );
      const saved = repo.save(result, false, config.llm.text.model);
      console.log(`[queue] done → result #${saved.id}, success=${!!result.success}, skipped=${!!result.skipped}`);
      res.send(views.queueProcessedRow(saved, paperlessUrl));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[queue] error for document #${docId}: ${msg}`);
      res.send(
        `<tr class="table-danger" id="queue-row-${docId}">
          <td class="mono">#${docId}</td>
          <td colspan="3"><code>${msg}</code></td>
        </tr>`
      );
    }
  });

  // ── Batch process N documents from the queue ─────────────────────────────────

  app.post('/queue/process-batch', async (req, res) => {
    const count = Math.max(1, parseInt(req.body.count as string, 10) || 1);
    try {
      const docs = await paperless.getDocumentsByTag(config.paperless.tag);
      const toProcess = docs.slice(0, count);
      console.log(`[batch] processing ${toProcess.length} of ${docs.length} document(s)`);

      for (const doc of toProcess) {
        console.log(`[batch] → document #${doc.id} "${doc.title}"`);
        const result = await broadcaster.capture(() =>
          processor.processDocument(doc.id, false)
        );
        const saved = repo.save(result, false, config.llm.text.model);
        console.log(`[batch] ✓ result #${saved.id}, success=${!!result.success}, skipped=${!!result.skipped}`);
      }

      console.log(`[batch] complete`);
      const remaining = await paperless.getDocumentsByTag(config.paperless.tag);
      res.send(views.queueDocRows(remaining, config.paperless.tag, paperlessUrl));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[batch] error: ${msg}`);
      res.status(500).send(
        `<tr class="table-danger"><td colspan="4"><code>${msg}</code></td></tr>`
      );
    }
  });

  app.listen(port, () => {
    console.log(`Web server running at http://localhost:${port}`);
  });
}
