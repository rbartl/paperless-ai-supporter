import { DbProcessingResult, ExtractedInvoiceData, PaperlessDocument } from '../types/index.js';

function layout(title: string, body: string, activeNav: 'results' | 'queue' | 'prompts'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} – Paperless AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    :root {
      --nav-bg: #0e1726;
      --accent: #3b82f6;
      --surface: #f8f9fb;
      --border: #e4e8ef;
    }
    body { font-family: 'DM Sans', sans-serif; background: var(--surface); }
    .navbar { background: var(--nav-bg) !important; }
    .navbar-brand { color: #fff !important; font-weight: 600; font-size: 1.1rem; }
    .navbar .nav-link { color: rgba(255,255,255,0.7) !important; font-size: 0.9rem; }
    .navbar .nav-link:hover, .navbar .nav-link.active { color: #fff !important; }
    .navbar .nav-link.active { border-bottom: 2px solid var(--accent); }
    .card { border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
    .stat-value { font-size: 2rem; font-weight: 600; line-height: 1; }
    .stat-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-top: 4px; }
    .table th { font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 2px solid var(--border); }
    .table td { vertical-align: middle; font-size: 0.88rem; }
    .table-hover tbody tr:hover { background: #f0f4ff; }
    code, .mono { font-family: 'DM Mono', monospace; font-size: 0.82em; }
    .badge { font-size: 0.72rem; font-weight: 500; padding: 0.3em 0.65em; border-radius: 6px; }
    .badge-success-soft { background: #dcfce7; color: #15803d; }
    .badge-error-soft { background: #fee2e2; color: #b91c1c; }
    .badge-skipped-soft { background: #fef9c3; color: #92400e; }
    .badge-dryrun-soft { background: #e0f2fe; color: #0369a1; }
    .conf-high { color: #15803d; font-weight: 600; }
    .conf-mid { color: #d97706; font-weight: 600; }
    .conf-low { color: #b91c1c; font-weight: 600; }
    .conf-none { color: #9ca3af; }
    .btn-accent { background: var(--accent); color: #fff; border: none; font-size: 0.8rem; padding: 0.3rem 0.8rem; border-radius: 8px; }
    .btn-accent:hover { background: #2563eb; color: #fff; }
    .btn-outline-sm { font-size: 0.78rem; padding: 0.25rem 0.65rem; border-radius: 8px; }
    .htmx-request .spin-on-load { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 768px) { .field-grid { grid-template-columns: 1fr; } }
    .field-item { background: #f8f9fb; border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 1rem; }
    .field-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 2px; }
    .field-value { font-weight: 500; font-size: 0.92rem; }
    .field-null { color: #9ca3af; font-style: italic; font-size: 0.85rem; }
    body.log-active { padding-bottom: 290px; }
    #log-panel { position:fixed; bottom:0; left:0; right:0; z-index:1050; background:#1e1e2e; border-top:2px solid #3b82f6; display:flex; flex-direction:column; height:270px; }
    #log-panel[hidden] { display:none; }
    #log-header { padding:5px 14px; background:#0d1117; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
    #log-lines { overflow-y:auto; padding:6px 14px 10px; font-family:'DM Mono',monospace; font-size:0.76rem; line-height:1.65; flex:1; }
  </style>
</head>
<body>
<nav class="navbar navbar-expand-lg mb-4">
  <div class="container-fluid px-4">
    <a class="navbar-brand" href="/">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="margin-right:6px;margin-top:-2px">
        <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z"/>
      </svg>
      Paperless AI
    </a>
    <div class="navbar-nav ms-3">
      <a class="nav-link ${activeNav === 'results' ? 'active' : ''}" href="/">Results</a>
      <a class="nav-link ${activeNav === 'queue' ? 'active' : ''}" href="/queue">Queue</a>
      <a class="nav-link ${activeNav === 'prompts' ? 'active' : ''}" href="/prompts">Prompts</a>
    </div>
  </div>
</nav>
<div class="container-fluid px-4 pb-5">
  ${body}
</div>
<div id="log-panel" hidden>
  <div id="log-header">
    <span style="color:#89b4fa;font-family:'DM Mono',monospace;font-size:0.78rem;font-weight:600">● Live Log</span>
    <button onclick="closeLog()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px">×</button>
  </div>
  <div id="log-lines"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script>
(function() {
  const panel = document.getElementById('log-panel');
  const lines = document.getElementById('log-lines');

  function lineColor(text, isError) {
    if (isError)                                        return '#f38ba8';
    if (text.startsWith('['))                           return '#89b4fa';
    if (text.startsWith('  ') || text.startsWith('\t')) return '#a6adc8';
    return '#cdd6f4';
  }

  window.closeLog = function() {
    panel.hidden = true;
    document.body.classList.remove('log-active');
  };

  const es = new EventSource('/api/log-stream');
  es.onmessage = function(e) {
    const d = JSON.parse(e.data);
    if (panel.hidden) {
      panel.hidden = false;
      document.body.classList.add('log-active');
    }
    const div = document.createElement('div');
    div.style.color = lineColor(d.line, d.level === 'error');
    div.style.whiteSpace = 'pre-wrap';
    div.textContent = d.line;
    const atBottom = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 40;
    lines.appendChild(div);
    if (atBottom) lines.scrollTop = lines.scrollHeight;
  };
})();
</script>
</body>
</html>`;
}

const spinIcon = `<svg class="spin-on-load" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" style="margin-right:3px">
  <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
  <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 7.757 2.997a.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
</svg>`;

function confidenceHtml(val: number | null): string {
  if (val === null) return '<span class="conf-none">–</span>';
  const normalized = val > 1 ? val / 100 : val;
  const pct = Math.round(normalized * 100);
  const cls = normalized >= 0.8 ? 'conf-high' : normalized >= 0.6 ? 'conf-mid' : 'conf-low';
  return `<span class="${cls}">${pct}%</span>`;
}

function statusBadge(row: DbProcessingResult): string {
  const dryTag = row.dry_run ? ' <span class="badge badge-dryrun-soft ms-1">Dry Run</span>' : '';
  if (!row.success) return `<span class="badge badge-error-soft">Error</span>${dryTag}`;
  if (row.skipped)  return `<span class="badge badge-skipped-soft">No Invoice</span>${dryTag}`;
  return `<span class="badge badge-success-soft">Processed</span>${dryTag}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-AT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const sub = (text: string) =>
  `<div class="text-muted" style="font-size:0.75rem;margin-top:2px">${text}</div>`;

export function resultRow(row: DbProcessingResult, paperlessUrl: string): string {
  const data: ExtractedInvoiceData | null = row.extracted_json
    ? JSON.parse(row.extracted_json)
    : null;

  const cur = data?.currency ?? 'EUR';
  const fmt = (n: number | null | undefined) =>
    n != null ? `${cur} ${Number(n).toFixed(2)}` : '–';

  const vendor   = data?.vendor ?? '–';
  const taxAcc   = data?.taxAccount ?? '–';
  const docTitle = row.new_title || row.document_title;

  const invoiceDate = data?.invoiceDate
    ? new Date(data.invoiceDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '–';

  const catBadge = data?.invoiceCategory
    ? `<span class="badge ${data.invoiceCategory === 'gewerbe' ? 'badge-success-soft' : 'badge-skipped-soft'} ms-1">${data.invoiceCategory}</span>`
    : '';

  const ustLine = (data?.nettoBetrag != null || data?.ustBetrag != null)
    ? `Net ${fmt(data?.nettoBetrag)} + VAT ${fmt(data?.ustBetrag)}${data?.ustSatz != null ? ` (${data.ustSatz}%)` : ''}`
    : '';

  return `<tr id="result-row-${row.id}">
  <td><span class="mono">${invoiceDate}</span></td>
  <td>
    <a href="${paperlessUrl}/documents/${row.document_id}/details" target="_blank" class="mono text-decoration-none">#${row.document_id}</a>
  </td>
  <td style="max-width:300px">
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(docTitle)}">${escHtml(docTitle)}</div>
    ${row.new_title && row.new_title !== row.document_title
      ? sub(`<span title="${escHtml(row.document_title)}">← ${escHtml(row.document_title)}</span>`)
      : ''}
    ${data?.invoiceNumber ? sub(`<span class="mono">${escHtml(data.invoiceNumber)}</span>${catBadge}`) : catBadge ? sub(catBadge) : ''}
  </td>
  <td>${escHtml(vendor)}</td>
  <td class="mono">
    ${escHtml(fmt(data?.invoiceTotal))}
    ${ustLine ? sub(`<span class="mono">${escHtml(ustLine)}</span>`) : ''}
  </td>
  <td><span class="badge bg-secondary bg-opacity-10 text-dark">${escHtml(taxAcc)}</span></td>
  <td>${confidenceHtml(data?.llmConfidence ?? null)}</td>
  <td>${statusBadge(row)}</td>
  <td>
    <div class="d-flex gap-1">
      <a href="/results/${row.id}" class="btn btn-outline-secondary btn-outline-sm">Detail</a>
      <button
        class="btn btn-accent"
        hx-post="/results/${row.id}/retry"
        hx-target="#result-row-${row.id}"
        hx-swap="outerHTML"
        hx-confirm="Reprocess document #${row.document_id}?"
      >${spinIcon}Retry</button>
    </div>
  </td>
</tr>`;
}

export function statsCards(
  stats: { total: number; success: number; failed: number; skipped: number }
): string {
  return `<div class="row g-3 mb-4" id="stats-row"
    hx-get="/api/stats"
    hx-trigger="every 30s"
    hx-target="#stats-row"
    hx-swap="outerHTML">
  <div class="col-6 col-md-3">
    <div class="card p-3">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total</div>
    </div>
  </div>
  <div class="col-6 col-md-3">
    <div class="card p-3">
      <div class="stat-value text-success">${stats.success}</div>
      <div class="stat-label">Processed</div>
    </div>
  </div>
  <div class="col-6 col-md-3">
    <div class="card p-3">
      <div class="stat-value" style="color:#b91c1c">${stats.failed}</div>
      <div class="stat-label">Errors</div>
    </div>
  </div>
  <div class="col-6 col-md-3">
    <div class="card p-3">
      <div class="stat-value" style="color:#d97706">${stats.skipped}</div>
      <div class="stat-label">No Invoice</div>
    </div>
  </div>
</div>`;
}

export function resultsPage(
  rows: DbProcessingResult[],
  stats: { total: number; success: number; failed: number; skipped: number },
  paperlessUrl: string
): string {
  const tableRows = rows.length
    ? rows.map((r) => resultRow(r, paperlessUrl)).join('\n')
    : `<tr><td colspan="9" class="text-center text-muted py-4">No results yet.</td></tr>`;

  const body = `
${statsCards(stats)}
<div class="card">
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-hover mb-0" id="results-table">
        <thead>
          <tr>
            <th>Invoice Date</th>
            <th>Doc.</th>
            <th>Title</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Account</th>
            <th>Confidence</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  </div>
</div>`;

  return layout('Results', body, 'results');
}

function fieldItem(label: string, value: string | number | null, mono = false): string {
  const display = value !== null && value !== undefined
    ? `<span class="field-value${mono ? ' mono' : ''}">${escHtml(String(value))}</span>`
    : `<span class="field-null">–</span>`;
  return `<div class="field-item">
    <div class="field-label">${label}</div>
    ${display}
  </div>`;
}

export function detailPage(row: DbProcessingResult, paperlessUrl: string): string {
  const data: ExtractedInvoiceData | null = row.extracted_json
    ? JSON.parse(row.extracted_json)
    : null;

  const currentTitle = row.new_title || row.document_title;

  const breadcrumb = `<nav aria-label="breadcrumb" class="mb-3">
    <ol class="breadcrumb" style="font-size:0.85rem">
      <li class="breadcrumb-item"><a href="/">Results</a></li>
      <li class="breadcrumb-item active">Result #${row.id}</li>
    </ol>
  </nav>`;

  const headerCard = `<div class="card mb-3 p-3 d-flex flex-row align-items-start gap-3">
    <div class="flex-grow-1">
      <div class="d-flex align-items-center gap-2 mb-1">
        ${statusBadge(row)}
        <span class="text-muted" style="font-size:0.8rem">${formatDate(row.processed_at)}</span>
        ${row.llm_model ? `<span class="mono text-muted" style="font-size:0.75rem">${escHtml(row.llm_model)}</span>` : ''}
      </div>
      <h5 class="mb-0">${escHtml(currentTitle)}</h5>
      ${row.new_title && row.new_title !== row.document_title
        ? `<div class="text-muted mt-1" style="font-size:0.82rem">Renamed from: <span class="mono">${escHtml(row.document_title)}</span></div>`
        : ''}
    </div>
    <div class="d-flex gap-2 flex-shrink-0">
      <a href="${paperlessUrl}/documents/${row.document_id}/details" target="_blank" class="btn btn-outline-secondary btn-outline-sm">
        Open in Paperless ↗
      </a>
      <button
        class="btn btn-accent"
        hx-post="/results/${row.id}/retry"
        hx-target="#result-row-detail"
        hx-swap="innerHTML"
        hx-confirm="Reprocess document #${row.document_id}?"
      >Retry</button>
    </div>
  </div>
  <div id="result-row-detail"></div>`;

  const errorSection = row.error_message
    ? `<div class="card mb-3 p-3 border-danger">
        <div class="d-flex align-items-start gap-2">
          <span style="color:#b91c1c;font-size:1.1rem">⚠</span>
          <div>
            <div class="fw-600 mb-1" style="color:#b91c1c">Error</div>
            <code style="word-break:break-all">${escHtml(row.error_message)}</code>
          </div>
        </div>
      </div>`
    : '';

  const extractedSection = data
    ? `<div class="card mb-3">
        <div class="card-header bg-transparent" style="font-size:0.85rem;font-weight:600;border-bottom:1px solid var(--border)">
          AI Extraction
        </div>
        <div class="card-body">
          <div class="field-grid">
            ${fieldItem('Vendor', data.vendor)}
            ${fieldItem('Invoice No.', data.invoiceNumber, true)}
            ${fieldItem('Invoice Date', data.invoiceDate, true)}
            ${fieldItem('Total', data.invoiceTotal !== null ? `${data.currency ?? 'EUR'} ${Number(data.invoiceTotal).toFixed(2)}` : null, true)}
            ${fieldItem('Net Amount', data.nettoBetrag !== null ? `${data.currency ?? 'EUR'} ${Number(data.nettoBetrag).toFixed(2)}` : null, true)}
            ${fieldItem('VAT Amount', data.ustBetrag !== null ? `${data.currency ?? 'EUR'} ${Number(data.ustBetrag).toFixed(2)}` : null, true)}
            ${fieldItem('VAT Rate', data.ustSatz !== null ? `${data.ustSatz}%` : null, true)}
            ${fieldItem('Tax Account', data.taxAccount)}
            ${fieldItem('Category', data.invoiceCategory)}
            ${fieldItem('Currency', data.currency, true)}
            <div class="field-item">
              <div class="field-label">Confidence</div>
              <div class="field-value">${confidenceHtml(data.llmConfidence)}</div>
            </div>
            <div class="field-item">
              <div class="field-label">Is Invoice</div>
              <div class="field-value">${data.isInvoice ? '✓ Yes' : '✗ No'}</div>
            </div>
          </div>
          ${data.summary
            ? `<div class="mt-3 p-3" style="background:#f8f9fb;border-radius:10px;font-size:0.88rem">
                <div class="field-label mb-1">AI Summary</div>
                ${escHtml(data.summary)}
              </div>`
            : ''}
        </div>
      </div>`
    : '';

  const rawSection = row.extracted_json
    ? `<div class="card mb-3">
        <div class="card-header bg-transparent d-flex justify-content-between align-items-center"
             style="font-size:0.85rem;font-weight:600;border-bottom:1px solid var(--border);cursor:pointer"
             data-bs-toggle="collapse" data-bs-target="#raw-json">
          <span>Raw Data (JSON)</span>
          <span style="font-size:0.75rem;color:#6b7280">▼</span>
        </div>
        <div id="raw-json" class="collapse">
          <div class="card-body p-0">
            <pre class="mono p-3 mb-0" style="background:#1e1e2e;color:#cdd6f4;font-size:0.78rem;border-radius:0 0 14px 14px;overflow-x:auto">${escHtml(JSON.stringify(JSON.parse(row.extracted_json), null, 2))}</pre>
          </div>
        </div>
      </div>`
    : '';

  const body = `${breadcrumb}${headerCard}${errorSection}${extractedSection}${rawSection}`;
  return layout(`Result #${row.id}`, body, 'results');
}

function queueDocRow(doc: PaperlessDocument, paperlessUrl: string): string {
  return `<tr id="queue-row-${doc.id}">
  <td><a href="${paperlessUrl}/documents/${doc.id}/details" target="_blank" class="mono text-decoration-none">#${doc.id}</a></td>
  <td>${escHtml(doc.title)}</td>
  <td class="text-muted mono" style="font-size:0.8rem">${formatDate(doc.added)}</td>
  <td>
    <button class="btn btn-accent"
      hx-post="/queue/${doc.id}/process"
      hx-target="#queue-row-${doc.id}"
      hx-swap="outerHTML">
      ${spinIcon}Process
    </button>
  </td>
</tr>`;
}

export function queueDocRows(docs: PaperlessDocument[], tagName: string, paperlessUrl: string): string {
  if (!docs.length) {
    return `<tr><td colspan="4" class="text-center text-muted py-4">No documents with tag <code>${escHtml(tagName)}</code> in the queue.</td></tr>`;
  }
  return docs.map((d) => queueDocRow(d, paperlessUrl)).join('\n');
}

export function queuePage(
  docs: PaperlessDocument[],
  tagName: string,
  paperlessUrl: string
): string {
  const body = `
<div class="d-flex align-items-center justify-content-between mb-3">
  <div>
    <h5 class="mb-0">Queue <span class="text-muted fw-normal" style="font-size:0.9rem">(${docs.length})</span></h5>
    <div class="text-muted" style="font-size:0.83rem">Documents with tag <code>${escHtml(tagName)}</code></div>
  </div>
  <div class="d-flex gap-2 align-items-center">
    <form hx-post="/queue/process-batch" hx-target="#queue-tbody" hx-swap="innerHTML"
          class="d-flex gap-2 align-items-center">
      <input type="number" name="count" value="4" min="1" max="100"
             class="form-control form-control-sm mono" style="width:64px">
      <button type="submit" class="btn btn-accent">
        ${spinIcon}Process
      </button>
    </form>
    <button class="btn btn-outline-secondary btn-outline-sm"
            hx-get="/queue" hx-target="body" hx-push-url="true">
      Refresh
    </button>
  </div>
</div>
<div class="card">
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-hover mb-0">
        <thead>
          <tr>
            <th>Doc.</th>
            <th>Title</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="queue-tbody">
          ${queueDocRows(docs, tagName, paperlessUrl)}
        </tbody>
      </table>
    </div>
  </div>
</div>
<div class="card mt-3">
  <div class="card-header bg-transparent" style="font-size:0.85rem;font-weight:600;border-bottom:1px solid var(--border)">
    Process by Document ID
  </div>
  <div class="card-body">
    <div class="text-muted mb-2" style="font-size:0.83rem">Process any document from Paperless regardless of queue tag.</div>
    <form hx-post="/queue/process-id" hx-target="#process-id-result" hx-swap="innerHTML"
          class="d-flex gap-2 align-items-center">
      <input type="number" name="docId" placeholder="Document ID" min="1"
             class="form-control form-control-sm mono" style="width:140px">
      <button type="submit" class="btn btn-accent">${spinIcon}Process</button>
    </form>
    <div id="process-id-result" class="mt-2"></div>
  </div>
</div>`;

  return layout('Queue', body, 'queue');
}

export function processIdResult(row: DbProcessingResult, paperlessUrl: string): string {
  const data: ExtractedInvoiceData | null = row.extracted_json ? JSON.parse(row.extracted_json) : null;
  const title = row.new_title || row.document_title;
  const vendor = data?.vendor ? ` · ${escHtml(data.vendor)}` : '';
  return `<div class="d-flex align-items-center gap-2 flex-wrap" style="font-size:0.85rem">
    ${statusBadge(row)}
    <a href="${paperlessUrl}/documents/${row.document_id}/details" target="_blank"
       class="mono text-decoration-none">#${row.document_id}</a>
    <span>${escHtml(title)}${vendor}</span>
    <a href="/results/${row.id}" class="btn btn-outline-secondary btn-outline-sm ms-1">Detail</a>
  </div>`;
}

export function queueProcessedRow(
  result: DbProcessingResult,
  paperlessUrl: string
): string {
  const data: ExtractedInvoiceData | null = result.extracted_json
    ? JSON.parse(result.extracted_json)
    : null;
  const docTitle = result.new_title || result.document_title;
  const vendor = data?.vendor ?? '–';

  return `<tr id="queue-row-${result.document_id}" class="table-success">
  <td><a href="${paperlessUrl}/documents/${result.document_id}/details" target="_blank" class="mono text-decoration-none">#${result.document_id}</a></td>
  <td>
    <div>${escHtml(docTitle)}</div>
    <div class="text-muted" style="font-size:0.78rem">${escHtml(vendor)}</div>
  </td>
  <td>${statusBadge(result)}</td>
  <td><a href="/results/${result.id}" class="btn btn-outline-secondary btn-outline-sm">Detail</a></td>
</tr>`;
}

export function errorPage(message: string): string {
  const body = `<div class="card p-4 text-center">
    <div style="color:#b91c1c;font-size:2rem">⚠</div>
    <div class="mt-2 fw-600">${escHtml(message)}</div>
  </div>`;
  return layout('Error', body, 'results');
}

export function promptsPage(prompts: Record<string, string>): string {
  const tabs = [
    { id: 'system',       label: 'System',       key: 'system' },
    { id: 'extraction',   label: 'Extraction',   key: 'extraction' },
    { id: 'vision',       label: 'Vision',       key: 'vision' },
    { id: 'custom-rules', label: 'Custom Rules', key: 'custom-rules' },
  ];

  const navItems = tabs.map((t, i) =>
    `<li class="nav-item">
      <button class="nav-link${i === 0 ? ' active' : ''}" data-bs-toggle="tab"
              data-bs-target="#tab-${t.id}" type="button">${t.label}</button>
    </li>`
  ).join('\n');

  const panes = tabs.map((t, i) =>
    `<div class="tab-pane fade${i === 0 ? ' show active' : ''}" id="tab-${t.id}">
      <form hx-post="/api/prompts/${t.key}" hx-target="#save-result-${t.id}" hx-swap="innerHTML"
            hx-encoding="application/x-www-form-urlencoded">
        <div class="card">
          <div class="card-body p-2">
            <textarea name="content" class="form-control mono" rows="22"
                      style="font-size:0.8rem;resize:vertical">${escHtml(prompts[t.key] ?? '')}</textarea>
          </div>
        </div>
        <div class="mt-2 d-flex gap-2 align-items-center">
          <button type="submit" class="btn btn-accent">Save</button>
          <span id="save-result-${t.id}" style="font-size:0.85rem"></span>
        </div>
      </form>
    </div>`
  ).join('\n');

  const body = `
<div class="d-flex align-items-center justify-content-between mb-3">
  <div>
    <h5 class="mb-0">Prompt Editor</h5>
    <div class="text-muted" style="font-size:0.83rem">Edit LLM prompt templates — changes take effect immediately</div>
  </div>
</div>
<ul class="nav nav-tabs mb-3">
  ${navItems}
</ul>
<div class="tab-content">
  ${panes}
</div>`;

  return layout('Prompts', body, 'prompts');
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
