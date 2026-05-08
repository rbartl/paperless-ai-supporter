import { DatabaseSync } from 'node:sqlite';
import { ProcessingResult, DbProcessingResult } from '../types/index.js';

const DDL = `
CREATE TABLE IF NOT EXISTS processing_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  document_title TEXT NOT NULL,
  new_title TEXT,
  processed_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  extracted_json TEXT,
  llm_model TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_id ON processing_results(document_id);
CREATE INDEX IF NOT EXISTS idx_processed_at ON processing_results(processed_at);
`;

export class ResultRepository {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(DDL);
  }

  save(result: ProcessingResult, dryRun: boolean, llmModel?: string): DbProcessingResult {
    const stmt = this.db.prepare(`
      INSERT INTO processing_results
        (document_id, document_title, new_title, processed_at, success, skipped, dry_run, error_message, extracted_json, llm_model)
      VALUES
        (@document_id, @document_title, @new_title, @processed_at, @success, @skipped, @dry_run, @error_message, @extracted_json, @llm_model)
    `);

    const info = stmt.run({
      document_id: result.documentId,
      document_title: result.title,
      new_title: result.newTitle ?? null,
      processed_at: new Date().toISOString(),
      success: result.success ? 1 : 0,
      skipped: result.skipped ? 1 : 0,
      dry_run: dryRun ? 1 : 0,
      error_message: result.error ?? null,
      extracted_json: result.extractedData ? JSON.stringify(result.extractedData) : null,
      llm_model: llmModel ?? null,
    });

    return this.findById(Number(info.lastInsertRowid))!;
  }

  findAll(limit = 500): DbProcessingResult[] {
    return this.db
      .prepare('SELECT * FROM processing_results ORDER BY processed_at DESC LIMIT ?')
      .all(limit) as unknown as DbProcessingResult[];
  }

  findById(id: number): DbProcessingResult | null {
    return (
      (this.db
        .prepare('SELECT * FROM processing_results WHERE id = ?')
        .get(id) as unknown as DbProcessingResult) ?? null
    );
  }

  findByDocumentId(docId: number): DbProcessingResult[] {
    return this.db
      .prepare(
        'SELECT * FROM processing_results WHERE document_id = ? ORDER BY processed_at DESC'
      )
      .all(docId) as unknown as DbProcessingResult[];
  }

  getStats(): { total: number; success: number; failed: number; skipped: number } {
    return this.db
      .prepare(
        `SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN success = 1 AND skipped = 0 THEN 1 ELSE 0 END), 0) as success,
          COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed,
          COALESCE(SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END), 0) as skipped
        FROM processing_results`
      )
      .get() as unknown as { total: number; success: number; failed: number; skipped: number };
  }
}
