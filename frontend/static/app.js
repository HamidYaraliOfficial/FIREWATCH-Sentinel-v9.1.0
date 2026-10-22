'use strict';

const $ = (selector) => document.querySelector(selector);
const API = '/api/v1';
let selectedScanId = null;
let scanCache = [];
let pollTimer = null;
let standardsRegistryCache = null;
let selectedStandardsControl = null;
let dashboardSummary = null;
let dashboardLastLoadedAt = 0;
let currentFindings = [];
let standardsPage = 1;
const STANDARDS_PAGE_SIZE = 30;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function prettyDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : esc(date.toLocaleString());
}

async function api(path, options = {}) {
  const key = sessionStorage.getItem('fw_api_key') || '';
  const headers = new Headers(options.headers || {});
  if (key) headers.set('X-API-Key', key);
  const requestPath = path === '/health' || path === '/ready' ? path : `${API}${path}`;
  const response = await fetch(requestPath, { ...options, headers });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!response.ok) {
    const detail = data && typeof data === 'object' ? data.detail : data;
    throw new Error(detail || `Request failed (HTTP ${response.status})`);
  }
  return data;
}

async function download(path, filename) {
  const key = sessionStorage.getItem('fw_api_key') || '';
  const response = await fetch(path, { headers: key ? { 'X-API-Key': key } : {} });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { const body = await response.json(); message = body.detail || message; } catch { /* keep status */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

function parseJsonField(id, label, expected) {
  const value = $(`#${id}`).value.trim();
  if (!value) return expected === 'array' ? [] : {};
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new Error(`${label} must be valid JSON.`); }
  if (expected === 'array' ? !Array.isArray(parsed) : (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')) {
    throw new Error(`${label} must be a JSON ${expected === 'array' ? 'array' : 'object'}.`);
  }
  return parsed;
}

function listField(id) {
  return $(`#${id}`).value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function render() {
  $('#app').innerHTML = `
    <a class="skip-link" href="#mainContent">Skip to content</a>
    <header class="top">
      <div class="brand-block">
        <a class="brand" href="#overviewPanel" aria-label="FIREWATCH overview">FIREWATCH <span class="brand-version">SENTINEL / v9</span></a>
        <div class="sub">Evidence-driven application security · Scope-controlled</div>
        <nav class="primary-nav" aria-label="Primary navigation">
          <a href="#overviewPanel">Overview</a><a href="#scanFormPanel">New assessment</a><a href="#findingsPanel">Findings</a><a href="#standardsPanel">Assurance</a>
        </nav>
      </div>
      <div class="header-tools">
        <div class="service-line"><span id="apiHealth" class="service-chip pending"><span class="status-dot"></span>Checking API</span><span id="lastUpdated" class="small">Waiting for first refresh</span></div>
        <div class="row api-key-row">
          <input class="input" id="apiKey" type="password" autocomplete="new-password" placeholder="API key (if configured)" aria-label="API key">
          <button class="btn secondary" id="saveKey" type="button">Use key</button>
          <button class="btn secondary" id="forgetKey" type="button" title="Forget the API key stored in this tab">Forget key</button>
          <button class="btn secondary" id="refresh" type="button">Refresh all</button>
          <a class="btn secondary" href="/docs">API Docs</a>
        </div>
      </div>
    </header>
    <main class="wrap" id="mainContent">
      <section class="dashboard-shell" id="overviewPanel" aria-labelledby="overviewTitle">
        <div class="page-heading">
          <div><div class="eyebrow">SECURITY OPERATIONS / OVERVIEW</div><h1 id="overviewTitle">Security posture at a glance</h1><p class="muted">Live portfolio metrics, scan activity and highest-risk open findings from this FIREWATCH instance.</p></div>
          <div class="row dashboard-actions"><button class="btn secondary" id="exportDashboardCsv" type="button">Export summary CSV</button><button class="btn secondary" id="exportDashboardJson" type="button">Export JSON</button><button class="btn secondary" id="printDashboard" type="button">Print / PDF</button><a class="btn" href="#scanFormPanel">+ New assessment</a></div>
        </div>
        <div id="dashboardMessage" class="dashboard-message" role="status" aria-live="polite" hidden></div>
        <div class="overview-metrics" aria-label="Security posture metrics">
          <article class="metric dashboard-metric"><div class="metric-label"><span class="metric-icon icon-blue">◎</span>Total scans</div><strong id="metricScans">—</strong><span class="metric-hint" id="metricScansHint">All recorded jobs</span></article>
          <article class="metric dashboard-metric"><div class="metric-label"><span class="metric-icon icon-violet">↻</span>Active jobs</div><strong id="metricActive">—</strong><span class="metric-hint">Queued or running now</span></article>
          <article class="metric dashboard-metric"><div class="metric-label"><span class="metric-icon icon-cyan">⌖</span>Unique targets</div><strong id="metricTargets">—</strong><span class="metric-hint">Distinct target URLs</span></article>
          <article class="metric dashboard-metric"><div class="metric-label"><span class="metric-icon icon-amber">⚑</span>Open findings</div><strong id="metricOpen">—</strong><span class="metric-hint">Require triage or remediation</span></article>
          <article class="metric dashboard-metric risk-metric"><div class="metric-label"><span class="metric-icon icon-red">!</span>Critical / high</div><strong id="metricCriticalHigh">—</strong><span class="metric-hint">Open high-priority risk</span></article>
          <article class="metric dashboard-metric"><div class="metric-label"><span class="metric-icon icon-green">✓</span>Completion rate</div><strong id="metricSuccess">—</strong><span class="metric-hint" id="metricDuration">Completed / terminal jobs</span></article>
        </div>
        <div class="dashboard-grid dashboard-grid-main">
          <section class="card dashboard-card chart-card"><div class="section-heading"><div><h2>Scan activity</h2><p class="small">Jobs created over the last 14 days</p></div><span class="chart-key"><i></i> Scans / day</span></div><div id="scanTrendChart" class="trend-chart"><div class="skeleton-line"></div></div></section>
          <section class="card dashboard-card"><div class="section-heading"><div><h2>Finding severity</h2><p class="small">All recorded findings · open counts shown separately</p></div></div><div id="severityBreakdown" class="severity-breakdown"><div class="muted">Loading severity distribution…</div></div><div class="sub-divider"></div><div class="mini-stat-row"><span class="small">Completed scans</span><strong id="metricCompleted">—</strong></div><div class="mini-stat-row"><span class="small">Failed scans</span><strong id="metricFailed">—</strong></div></section>
        </div>
        <div class="dashboard-grid dashboard-grid-secondary">
          <section class="card dashboard-card"><div class="section-heading"><div><h2>Recent assessments</h2><p class="small">Select a scan to open its timeline and evidence</p></div><a href="#scanFormPanel" class="text-link">Run a scan →</a></div><div id="recentScans" class="recent-scans"><div class="muted">Loading recent assessments…</div></div></section>
          <section class="card dashboard-card"><div class="section-heading"><div><h2>Highest-risk open findings</h2><p class="small">Ordered by risk score · verify findings before action</p></div><a href="#findingsPanel" class="text-link">View selected scan →</a></div><div id="riskQueue" class="risk-queue"><div class="muted">Loading risk queue…</div></div></section>
        </div>
        <div class="dashboard-grid dashboard-grid-secondary">
          <section class="card dashboard-card"><div class="section-heading"><div><h2>Most assessed targets</h2><p class="small">Targets with the highest scan count</p></div></div><div id="topTargets" class="top-targets"><div class="muted">Loading target portfolio…</div></div></section>
          <section class="card dashboard-card posture-note"><div class="section-heading"><div><h2>Operational guidance</h2><span class="badge info">Scope-first</span></div></div><ul><li>Run assessments only against assets covered by documented authorization.</li><li>Prioritize open critical and high findings, then validate evidence manually.</li><li>A completed scan is not proof that an application is vulnerability-free.</li><li>Use the standards checklist to track owners, evidence, reviews and due dates.</li></ul><div class="row"><a href="#standardsPanel" class="btn secondary">Open assurance tracker</a><a href="/ready" class="text-link">Readiness endpoint ↗</a></div></section>
        </div>
      </section>
      <section class="card" id="scanFormPanel">
        <div class="eyebrow">ASSESSMENT WORKSPACE</div>
        <h1>New security assessment</h1>
        <p class="muted">Run an evidence-producing assessment against a target you are explicitly authorized to test. The default engine is non-destructive: it does not brute-force credentials, submit arbitrary forms, perform write/delete operations, or send executable injection payloads.</p>
        <div class="notice"><b>Before starting:</b> confirm written authorization, approved hosts/ports, excluded paths, credentials, request rate, and testing window. Baseline and comprehensive checks have different coverage and limits.</div>
        <form id="scanForm" style="margin-top:14px">
          <label class="small" for="url">Target URL</label>
          <input class="input" id="url" type="url" value="http://127.0.0.1:8765/" required maxlength="2048" autocomplete="url">
          <div class="grid3" style="margin-top:12px">
            <div><label class="small" for="profile">Assessment profile</label><select class="input" id="profile"><option value="baseline">Baseline · passive</option><option value="standard" selected>Standard · recommended</option><option value="comprehensive">Comprehensive · bounded</option></select></div>
            <div><label class="small" for="pages">Max pages</label><input class="input" id="pages" type="number" min="1" max="5000" value="300"></div>
            <div><label class="small" for="depth">Max crawl depth</label><input class="input" id="depth" type="number" min="0" max="20" value="8"></div>
          </div>
          <div class="grid3" style="margin-top:12px">
            <div><label class="small" for="delay">Minimum request delay (ms)</label><input class="input" id="delay" type="number" min="0" max="10000" value="150"></div>
            <label class="checkline"><input type="checkbox" id="browser" checked> Browser discovery</label>
            <label class="checkline"><input type="checkbox" id="gql" checked> Read-only GraphQL introspection</label>
          </div>
          <div class="grid3" style="margin-top:12px">
            <label class="checkline"><input type="checkbox" id="robots" checked> Respect robots.txt</label>
            <label class="checkline"><input type="checkbox" id="parameterProbes" checked> Harmless GET canaries</label>
            <label class="checkline"><input type="checkbox" id="passive"> Passive-only assessment</label>
          </div>
          <details class="advanced" style="margin-top:14px">
            <summary>Scope controls and exclusions</summary>
            <div class="grid3" style="margin-top:12px">
              <div><label class="small" for="allowedHosts">Additional in-scope hosts (one per line)</label><textarea class="input" id="allowedHosts" rows="3" placeholder="https://api.example.com"></textarea><div class="small">Only add hosts explicitly approved for this assessment.</div></div>
              <div><label class="small" for="exclusions">Excluded paths (one per line)</label><textarea class="input" id="exclusions" rows="3" placeholder="/logout&#10;/payment&#10;/delete-account"></textarea><div class="small">Excluded paths are never crawled or requested.</div></div>
              <div class="scope-note"><b>Scope enforcement</b><p class="small">Out-of-scope hosts/ports are blocked. Redirects are not automatically followed by the HTTP engine. Sensitive query-string URLs are excluded.</p></div>
            </div>
          </details>
          <details class="advanced" style="margin-top:10px">
            <summary>Authentication and authorization profiles (optional)</summary>
            <p class="small">Credentials are encrypted in the database. Primary headers/cookies are only attached to the exact root hostname, root scheme, and HTTPS for public targets. They are not saved by this page to local storage. Use dedicated, low-privilege test identities.</p>
            <div class="grid3" style="margin-top:12px">
              <div><label class="small" for="requestHeaders">Primary request headers (JSON object)</label><textarea class="input secret-input" id="requestHeaders" rows="5" spellcheck="false" autocomplete="off" placeholder='{"Authorization":"Bearer YOUR_TEST_TOKEN"}'></textarea><div class="small">Example header values are placeholders; do not paste production tokens.</div></div>
              <div><label class="small" for="authCookies">Cookie header (optional)</label><input class="input secret-input" id="authCookies" type="password" autocomplete="new-password" placeholder="session=TEST_SESSION"><div class="small">Sent only to the root host under the credential policy.</div></div>
              <div><label class="small" for="authProfiles">Role comparison profiles (JSON array)</label><textarea class="input secret-input" id="authProfiles" rows="5" spellcheck="false" autocomplete="off" placeholder='[{"name":"admin","headers":{"Authorization":"Bearer ADMIN_TEST_TOKEN"}},{"name":"user","headers":{"Authorization":"Bearer USER_TEST_TOKEN"}}]'></textarea><div class="small">Only read-only GET comparisons are used; findings are review candidates, not proof of IDOR/BOLA.</div></div>
            </div>
          </details>
          <div class="row" style="margin-top:14px"><label class="checkline"><input type="checkbox" id="ack"> I confirm this target and added hosts are authorized for security testing.</label></div>
          <div class="row" style="margin-top:14px"><button class="btn" id="start" type="submit">Start assessment</button><span id="msg" class="small" role="status" aria-live="polite"></span></div>
        </form>
      </section>
      <section class="grid assessment-workspace" id="assessmentWorkspace">
        <div class="card scan-list-card"><div class="row between"><h2>Scan jobs</h2><span class="small" id="scanCount">0 jobs</span></div><div class="filter-stack"><input class="input" id="scanSearch" type="search" placeholder="Search target or scan ID…" aria-label="Search scan jobs"><select class="input" id="scanStatusFilter" aria-label="Filter scans by status"><option value="">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="canceled">Canceled</option></select></div><div id="scanList"></div></div>
        <div>
          <div class="card"><h2 id="detailTitle">Select a scan</h2><div id="detail"><div class="muted">Choose a job to inspect its status, findings, coverage, evidence, and reports.</div></div></div>
          <div class="card" id="findingsPanel"><div class="row between"><h2>Findings</h2><span class="small" id="findingCount">0 findings</span></div><div class="filter-row"><input class="input" id="findingSearch" type="search" placeholder="Search title, rule, endpoint…" aria-label="Search findings"><select class="input" id="findingSeverityFilter" aria-label="Filter findings by severity"><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="info">Informational</option></select></div><div id="findings"><div class="muted">Findings will appear here when a scan is selected.</div></div></div>
          <div class="card"><h2>Assessment detail</h2><div id="detailPanel" class="muted">Coverage and evidence details will appear here.</div></div>
        </div>
      </section>
      <section class="card" id="standardsPanel">
        <div class="row between"><div><h2>Standards & Assurance Checklist</h2><p class="small">Project-scoped control tracker with framework mappings, evidence, owner, due date, reviewer and immutable-style audit events.</p></div><div class="row"><button class="btn secondary" id="refreshStandards" type="button">Refresh checklist</button><button class="btn secondary" id="exportStandards" type="button">Export CSV</button><button class="btn secondary" id="downloadStandardsWorkbook" type="button">Excel workbook</button><a class="btn secondary" href="/standards/STANDARDS_CHECKLIST.md" target="_blank" rel="noopener">Full checklist</a></div></div>
        <div class="notice"><b>Important:</b> the catalogue is a curated crosswalk, not a certification or legal-conformity statement. Mark a control compliant only with relevant evidence and reviewer approval. Verify the exact edition/clauses in official source documents.</div>
        <div class="grid3" style="margin-top:12px">
          <div><label class="small" for="stdSearch">Search controls</label><input class="input" id="stdSearch" placeholder="Control ID, keyword, framework" maxlength="250"></div>
          <div><label class="small" for="stdFramework">Framework</label><select class="input" id="stdFramework"><option value="">All frameworks</option></select></div>
          <div><label class="small" for="stdStatus">Project status</label><select class="input" id="stdStatus"><option value="">All statuses</option><option value="not_assessed">Not assessed</option><option value="evidence_pending">Evidence pending</option><option value="blocked">Blocked</option><option value="compliant">Compliant</option><option value="partially_compliant">Partially compliant</option><option value="non_compliant">Non-compliant</option><option value="not_applicable">Not applicable</option></select></div>
        </div>
        <div class="grid3" style="margin-top:10px">
          <div><label class="small" for="stdPriority">Priority</label><select class="input" id="stdPriority"><option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></div>
          <div><label class="small" for="stdApplicability">Applicability</label><select class="input" id="stdApplicability"><option value="">All levels</option><option value="core">Core</option><option value="conditional">Conditional</option><option value="adjacent">Adjacent</option></select></div>
          <div class="small" id="standardsMessage" role="status" aria-live="polite">Loading checklist…</div>
        </div>
        <div class="grid3" style="margin-top:10px">
          <div><label class="small" for="stdDomain">Domain</label><select class="input" id="stdDomain"><option value="">All domains</option></select></div>
          <div><label class="small" for="stdVerificationMode">Verification mode</label><select class="input" id="stdVerificationMode"><option value="">All modes</option></select></div>
          <div><label class="small" for="stdRelationship">Relationship</label><select class="input" id="stdRelationship"><option value="">All relation types</option></select></div>
        </div>
        <div id="standardsSummary" class="grid3" style="margin-top:14px"></div>
        <div id="standardsTable" class="table-wrap" style="margin-top:12px"><div class="muted">Loading standards checklist…</div></div>
        <div class="row between" style="margin-top:12px"><span id="standardsPagination" class="small"></span><div class="row"><button class="btn secondary" id="standardsPrev" type="button">Previous</button><button class="btn secondary" id="standardsNext" type="button">Next</button></div></div>
        <div id="standardsEditor" style="margin-top:16px"></div>
      </section>
      <div class="footer">FIREWATCH Sentinel · Security operations console + standards assurance. Automated findings and checklist progress do not prove absence of vulnerabilities or legal compliance.</div>
    </main>`;

  if (sessionStorage.getItem('fw_api_key')) $('#apiKey').placeholder = 'API key stored for this tab';
  $('#refresh').addEventListener('click', refreshAll);
  $('#forgetKey').addEventListener('click', async () => { sessionStorage.removeItem('fw_api_key'); $('#apiKey').value = ''; $('#dashboardMessage').hidden = false; $('#dashboardMessage').textContent = 'API key removed from this browser tab.'; await refreshAll(); });
  $('#exportDashboardCsv').addEventListener('click', exportDashboardCsv);
  $('#exportDashboardJson').addEventListener('click', exportDashboardJson);
  $('#printDashboard').addEventListener('click', () => window.print());
  $('#scanSearch').addEventListener('input', renderScanList);
  $('#scanStatusFilter').addEventListener('change', renderScanList);
  $('#findingSearch').addEventListener('input', renderFindingList);
  $('#findingSeverityFilter').addEventListener('change', renderFindingList);
  $('#scanForm').addEventListener('submit', startScan);
  $('#profile').addEventListener('change', applyProfile);
  $('#saveKey').addEventListener('click', saveApiKey);
  $('#apiKey').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveApiKey(); }
  });
  $('#refreshStandards').addEventListener('click', () => loadStandards().catch(showStandardsError));
  $('#exportStandards').addEventListener('click', async () => {
    try { await download('/api/v1/standards/checklist/export.csv?project_key=default', 'firewatch-standards-checklist.csv'); }
    catch (error) { showStandardsError(error); }
  });
  $('#downloadStandardsWorkbook').addEventListener('click', async () => {
    try { await download('/api/v1/standards/workbook', 'FIREWATCH_Standards_Checklist_v9_Pro.xlsx'); }
    catch (error) { showStandardsError(error); }
  });
  for (const id of ['stdFramework', 'stdStatus', 'stdPriority', 'stdApplicability', 'stdDomain', 'stdVerificationMode', 'stdRelationship']) {
    $(`#${id}`).addEventListener('change', () => { standardsPage = 1; loadStandards().catch(showStandardsError); });
  }
  $('#stdSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); standardsPage = 1; loadStandards().catch(showStandardsError); }
  });
  $('#stdSearch').addEventListener('change', () => { standardsPage = 1; loadStandards().catch(showStandardsError); });
  $('#standardsPrev').addEventListener('click', () => { if (standardsPage > 1) { standardsPage--; loadStandards().catch(showStandardsError); } });
  $('#standardsNext').addEventListener('click', () => { standardsPage++; loadStandards().catch(showStandardsError); });
}

function statusLabel(value) {
  return String(value || 'not_assessed').replaceAll('_', ' ');
}

function standardStatusBadge(status) {
  const classMap = {
    compliant: 'std-ok', partially_compliant: 'std-partial', non_compliant: 'std-fail',
    blocked: 'std-blocked', evidence_pending: 'std-pending', not_applicable: 'std-na', not_assessed: 'std-unassessed',
  };
  return `<span class="badge ${classMap[status] || 'std-unassessed'}">${esc(statusLabel(status))}</span>`;
}

async function loadStandardsRegistry() {
  standardsRegistryCache = await api('/standards/registry');
  const select = $('#stdFramework');
  const old = select.value;
  select.innerHTML = '<option value="">All frameworks</option>' + (standardsRegistryCache.frameworks || []).map((f) =>
    `<option value="${esc(f.id)}">${esc(f.name)} — ${esc(f.version_or_status)}</option>`).join('');
  if (old) select.value = old;
  const selectOptions = (id, items, valueFn, labelFn, firstLabel) => {
    const el = $(`#${id}`); const previous = el.value;
    el.innerHTML = `<option value="">${esc(firstLabel)}</option>` + items.map((item) => `<option value="${esc(valueFn(item))}">${esc(labelFn(item))}</option>`).join('');
    if (previous) el.value = previous;
  };
  selectOptions('stdDomain', standardsRegistryCache.domains || [], (x) => x.id, (x) => `${x.id} — ${x.name}`, 'All domains');
  selectOptions('stdVerificationMode', (standardsRegistryCache.verification_modes || []).map((x) => ({id:x,name:x})), (x) => x.id, (x) => x.name, 'All modes');
  selectOptions('stdRelationship', (standardsRegistryCache.relationship_options || []).map((x) => ({id:x,name:x})), (x) => x.id, (x) => x.name, 'All relation types');
  await loadStandards();
}

async function loadStandards() {
  const message = $('#standardsMessage');
  message.textContent = 'Loading standards checklist…';
  const params = new URLSearchParams({ project_key: 'default', page: String(standardsPage), page_size: String(STANDARDS_PAGE_SIZE) });
  for (const [field, id] of [['framework_id','stdFramework'],['status','stdStatus'],['priority','stdPriority'],['applicability','stdApplicability'],['domain_id','stdDomain'],['verification_mode','stdVerificationMode'],['relationship','stdRelationship'],['search','stdSearch']]) {
    const value = $(`#${id}`).value.trim();
    if (value) params.set(field, value);
  }
  const [pageData, summary] = await Promise.all([
    api(`/standards/checklist?${params.toString()}`),
    api('/standards/summary?project_key=default'),
  ]);
  renderStandardsSummary(summary);
  renderStandardsRows(pageData);
  message.textContent = `${summary.framework_count ?? (standardsRegistryCache?.frameworks || []).length} framework references · ${summary.domain_count ?? '—'} domains · ${summary.catalog_control_count ?? summary.total_controls} catalogue controls`;
}

function renderStandardsSummary(summary) {
  const b = summary.by_status || {};
  const metrics = [
    ['Catalogue controls', summary.total_controls ?? 0],
    ['Assessment progress', `${summary.assessment_progress_pct ?? 0}%`],
    ['Compliant', b.compliant ?? 0],
    ['Partially compliant', b.partially_compliant ?? 0],
    ['Non-compliant', b.non_compliant ?? 0],
    ['Evidence pending / blocked', (b.evidence_pending ?? 0) + (b.blocked ?? 0)],
  ];
  $('#standardsSummary').innerHTML = metrics.map(([label, value]) => `<div class="metric std-metric"><span class="small">${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}

function renderStandardsRows(data) {
  const rows = data.controls || [];
  const totalPages = Math.max(1, Number(data.pages || 1));
  $('#standardsPrev').disabled = data.page <= 1;
  $('#standardsNext').disabled = data.page >= totalPages;
  $('#standardsPagination').textContent = `Page ${data.page} of ${totalPages} · ${data.total} matching controls`;
  if (!rows.length) {
    $('#standardsTable').innerHTML = '<div class="muted">No controls match the selected filters.</div>';
    $('#standardsEditor').innerHTML = '';
    return;
  }
  $('#standardsTable').innerHTML = `<table class="table standards-table"><thead><tr><th>Control</th><th>Domain</th><th>Requirement</th><th>Priority</th><th>Applicability</th><th>Relation</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((item) => `
    <tr><td><code>${esc(item.id)}</code></td><td>${esc(item.domain)}</td><td>${esc(item.requirement)}</td><td><span class="badge std-priority">${esc(item.priority)}</span></td><td>${esc(item.applicability)}</td><td>${esc((item.relationship_types || []).join(", "))}</td><td>${standardStatusBadge(item.status)}</td><td><button class="btn secondary small-btn" type="button" data-std-control="${esc(item.id)}">Review</button></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-std-control]').forEach((button) => button.addEventListener('click', () => {
    selectedStandardsControl = rows.find((row) => row.id === button.dataset.stdControl) || null;
    renderStandardsEditor(selectedStandardsControl);
  }));
  if (selectedStandardsControl && !rows.some((row) => row.id === selectedStandardsControl.id)) {
    selectedStandardsControl = null;
    $('#standardsEditor').innerHTML = '';
  }
}

function renderStandardsEditor(control) {
  if (!control) { $('#standardsEditor').innerHTML = ''; return; }
  const statuses = ['not_assessed','evidence_pending','blocked','compliant','partially_compliant','non_compliant','not_applicable'];
  const options = statuses.map((s) => `<option value="${s}" ${control.status === s ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('');
  const sources = (control.source_urls || []).map((url) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></li>`).join('');
  $('#standardsEditor').innerHTML = `
    <div class="std-editor">
      <div class="row between"><div><h3>${esc(control.id)} · ${esc(control.domain)}</h3><p>${esc(control.requirement)}</p></div><span class="badge std-priority">${esc(control.priority)} · ${esc(control.applicability)}</span></div>
      <p class="small"><b>Acceptance criteria:</b> ${esc(control.acceptance_criteria)}</p>
      <p class="small"><b>Expected evidence:</b> ${esc(control.expected_evidence)}</p>
      <details class="advanced"><summary>Framework mappings and official sources (${(control.framework_ids || []).length})</summary><p class="small">${esc((control.framework_mappings || []).map((m) => `${m.framework_name} ${m.version}`).join(' · '))}</p><ul class="small">${sources}</ul><p class="small">Mappings indicate related subjects/families; verify exact requirements/clauses in the official edition.</p></details>
      <form id="standardsEditForm" style="margin-top:12px">
        <div class="grid3">
          <div><label class="small" for="stdEditStatus">Status</label><select class="input" id="stdEditStatus">${options}</select></div>
          <div><label class="small" for="stdOwner">Owner</label><input class="input" id="stdOwner" maxlength="160" value="${esc(control.owner || '')}" placeholder="Control owner"></div>
          <div><label class="small" for="stdReviewer">Reviewer</label><input class="input" id="stdReviewer" maxlength="160" value="${esc(control.reviewer || '')}" placeholder="Independent reviewer"></div>
        </div>
        <div class="grid3" style="margin-top:10px">
          <div><label class="small" for="stdDue">Due date</label><input class="input" id="stdDue" type="date" value="${esc(control.due_date || '')}"></div>
          <div><label class="small" for="stdEvidenceUrl">Evidence URL</label><input class="input" id="stdEvidenceUrl" type="url" maxlength="2048" value="${esc(control.evidence_url || '')}" placeholder="https://... (no secret query parameters)"></div>
          <div><label class="small" for="stdReviewed">Last reviewed</label><input class="input" id="stdReviewed" type="date" value="${esc(control.last_reviewed || '')}"></div>
        </div>
        <div class="grid3" style="margin-top:10px">
          <div><label class="small" for="stdEvidenceNote">Evidence note (sanitize secrets/PII)</label><textarea class="input" id="stdEvidenceNote" rows="4" maxlength="4000">${esc(control.evidence_note || '')}</textarea></div>
          <div><label class="small" for="stdJustification">Exception / N/A justification</label><textarea class="input" id="stdJustification" rows="4" maxlength="2000">${esc(control.justification || '')}</textarea></div>
          <div class="scope-note"><b>Revision ${esc(control.revision ?? 0)}</b><p class="small">Concurrent updates use optimistic revision checking. Reviewer/owner fields are user supplied and do not independently prove identity.</p><p class="small">Required: evidence + reviewer + owner for assessed compliant/partial/non-compliant states. N/A requires a documented rationale.</p></div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" id="saveStandardControl" type="submit">Save checklist state</button><button class="btn secondary" id="loadStandardHistory" type="button">View audit history</button><span class="small" id="stdSaveMessage" role="status" aria-live="polite"></span></div>
      </form>
      <div id="stdHistory" style="margin-top:10px"></div>
    </div>`;
  $('#standardsEditForm').addEventListener('submit', saveStandardControl);
  $('#loadStandardHistory').addEventListener('click', () => loadStandardHistory(control.id));
}

async function saveStandardControl(event) {
  event.preventDefault();
  const control = selectedStandardsControl;
  if (!control) return;
  const button = $('#saveStandardControl');
  const msg = $('#stdSaveMessage');
  button.disabled = true; msg.textContent = 'Saving…';
  const payload = {
    project_key: 'default', status: $('#stdEditStatus').value,
    expected_revision: Number(control.revision || 0), owner: $('#stdOwner').value.trim() || null,
    reviewer: $('#stdReviewer').value.trim() || null, due_date: $('#stdDue').value || null,
    last_reviewed: $('#stdReviewed').value || null, evidence_url: $('#stdEvidenceUrl').value.trim() || null,
    evidence_note: $('#stdEvidenceNote').value.trim() || null, justification: $('#stdJustification').value.trim() || null,
    updated_by: 'dashboard-editor-label',
  };
  try {
    const updated = await api(`/standards/checklist/${encodeURIComponent(control.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    selectedStandardsControl = { ...control, ...updated.state };
    msg.textContent = `Saved revision ${updated.state.revision}; audit event ${updated.audit_event_id}.`;
    await loadStandards();
    // Re-open the updated item in the current result page using the fresh revision/state.
    selectedStandardsControl = { ...control, ...updated.state };
    renderStandardsEditor(selectedStandardsControl);
  } catch (error) { msg.textContent = error.message; }
  finally { if ($('#saveStandardControl')) $('#saveStandardControl').disabled = false; }
}

async function loadStandardHistory(controlId) {
  const target = $('#stdHistory');
  target.innerHTML = '<div class="muted">Loading audit history…</div>';
  try {
    const events = await api(`/standards/checklist/${encodeURIComponent(controlId)}/history?project_key=default&limit=50`);
    target.innerHTML = events.length ? `<h4>Audit history (${events.length})</h4><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Actor label</th><th>Action</th><th>Previous status</th><th>New status / revision</th></tr></thead><tbody>${events.map((e) => `<tr><td>${prettyDate(e.created_at)}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.previous_state?.status || '—')}</td><td>${esc(e.new_state?.status || '—')} / ${esc(e.new_state?.revision ?? '—')}</td></tr>`).join('')}</tbody></table></div><p class="small">The actor field is audit metadata from the API request, not an independently authenticated identity unless an external identity layer is configured.</p>` : '<div class="muted">No audit events yet.</div>';
  } catch (error) { target.textContent = error.message; }
}

function showStandardsError(error) {
  const message = error?.message || String(error);
  if ($('#standardsMessage')) $('#standardsMessage').textContent = message;
  showError(error);
}

function applyProfile() {
  const presets = {
    baseline: { pages: 100, depth: 4, delay: 300, browser: false, gql: false, probe: false, passive: true },
    standard: { pages: 300, depth: 8, delay: 150, browser: true, gql: true, probe: true, passive: false },
    comprehensive: { pages: 1500, depth: 12, delay: 200, browser: true, gql: true, probe: true, passive: false },
  };
  const value = presets[$('#profile').value];
  $('#pages').value = value.pages;
  $('#depth').value = value.depth;
  $('#delay').value = value.delay;
  $('#browser').checked = value.browser;
  $('#gql').checked = value.gql;
  $('#parameterProbes').checked = value.probe;
  $('#passive').checked = value.passive;
}

async function saveApiKey() {
  const field = $('#apiKey');
  const key = field.value.trim();
  if (key) sessionStorage.setItem('fw_api_key', key);
  else sessionStorage.removeItem('fw_api_key');
  field.value = '';
  try { await refreshScans(); await loadDashboardSummary(true); }
  catch (error) { $('#msg').textContent = error.message; }
}

async function startScan(event) {
  event.preventDefault();
  const message = $('#msg');
  message.textContent = '';
  if (!$('#ack').checked) { message.textContent = 'Confirm the authorization checkbox before starting.'; return; }

  let requestHeaders;
  let authorizationProfiles;
  try {
    requestHeaders = parseJsonField('requestHeaders', 'Primary request headers', 'object');
    authorizationProfiles = parseJsonField('authProfiles', 'Authorization profiles', 'array');
    if (Object.values(requestHeaders).some((value) => typeof value !== 'string')) {
      throw new Error('Every primary request header value must be a string.');
    }
  } catch (error) { message.textContent = error.message; return; }

  const profile = $('#profile').value;
  const payload = {
    target_url: $('#url').value.trim(),
    scope_acknowledged: true,
    profile,
    max_pages: Number($('#pages').value),
    max_depth: Number($('#depth').value),
    max_endpoints: profile === 'comprehensive' ? 7000 : profile === 'baseline' ? 500 : 2000,
    max_concurrency: profile === 'comprehensive' ? 4 : profile === 'baseline' ? 2 : 3,
    request_delay_ms: Number($('#delay').value),
    enable_browser: profile !== 'baseline' && $('#browser').checked,
    enable_api_introspection: profile !== 'baseline' && $('#gql').checked,
    enable_safe_parameter_probes: profile !== 'baseline' && $('#parameterProbes').checked,
    respect_robots: $('#robots').checked,
    passive_only: profile === 'baseline' || $('#passive').checked,
    exclusions: listField('exclusions'),
    allowed_hosts: listField('allowedHosts'),
    request_headers: requestHeaders,
    auth_cookies: $('#authCookies').value || null,
    authorization_profiles: authorizationProfiles,
  };

  const button = $('#start');
  button.disabled = true;
  message.textContent = 'Creating scan job…';
  try {
    const created = await api('/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // Clear credentials from editable controls after the server accepts the job.
    for (const id of ['requestHeaders', 'authCookies', 'authProfiles']) $(`#${id}`).value = '';
    selectedScanId = created.id;
    message.textContent = `Queued scan ${created.id}`;
    await refreshScans();
    await loadDashboardSummary(true);
  } catch (error) {
    message.textContent = error.message;
  } finally { button.disabled = false; }
}

async function refreshScans() {
  const scans = await api('/scans?limit=100');
  scanCache = scans;
  renderScanList();
  if (selectedScanId) {
    if (scans.some((scan) => scan.id === selectedScanId)) await refreshDetail();
    else selectedScanId = null;
  }
}

async function refreshAll() {
  const button = $('#refresh');
  button.disabled = true;
  try {
    const results = await Promise.allSettled([
      refreshScans(),
      loadDashboardSummary(true),
      loadStandards().catch((error) => { showStandardsError(error); }),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) $('#dashboardMessage').textContent = failure.reason?.message || 'One or more dashboard panels could not be refreshed.';
  } finally { button.disabled = false; }
}

async function loadDashboardSummary(force = false) {
  if (!force && Date.now() - dashboardLastLoadedAt < 12000) return;
  dashboardLastLoadedAt = Date.now();
  const summaryNode = $('#dashboardMessage');
  const results = await Promise.allSettled([api('/dashboard/summary'), api('/health'), api('/ready')]);
  const [summaryResult, healthResult, readyResult] = results;
  const healthOk = healthResult.status === 'fulfilled' && healthResult.value?.status === 'ok';
  const readyOk = readyResult.status === 'fulfilled' && readyResult.value?.status === 'ready';
  const healthNode = $('#apiHealth');
  healthNode.className = `service-chip ${healthOk && readyOk ? 'healthy' : healthOk ? 'pending' : 'unhealthy'}`;
  healthNode.innerHTML = `<span class="status-dot"></span>${healthOk && readyOk ? 'API operational' : healthOk ? 'Database not ready' : 'API unavailable'}`;
  if (summaryResult.status !== 'fulfilled') {
    summaryNode.hidden = false;
    const error = summaryResult.reason?.message || 'Dashboard summary could not be loaded.';
    summaryNode.textContent = /401|403|API key/i.test(error) ? 'Dashboard data is protected. Enter the configured API key and select “Use key”.' : error;
    $('#lastUpdated').textContent = `Refresh attempted ${new Date().toLocaleTimeString()}`;
    return;
  }
  dashboardSummary = summaryResult.value;
  renderDashboard(dashboardSummary);
  summaryNode.hidden = true;
  $('#lastUpdated').textContent = `Updated ${new Date(dashboardSummary.generated_at || Date.now()).toLocaleTimeString()}`;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '—';
  const value = Math.max(0, Number(seconds));
  if (value < 60) return `${Math.round(value)}s avg`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s avg`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m avg`;
}

function renderTrendChart(points) {
  if (!Array.isArray(points) || !points.length || points.every((point) => !Number(point.count))) {
    $('#scanTrendChart').innerHTML = '<div class="chart-empty"><span class="empty-mark">↗</span><b>No scan activity yet</b><span class="small">Start an authorized assessment to populate the 14-day trend.</span></div>';
    return;
  }
  const width = 680; const height = 190; const left = 26; const right = 14; const top = 20; const bottom = 42;
  const values = points.map((point) => Math.max(0, Number(point.count) || 0));
  const maxValue = Math.max(1, ...values);
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const coords = values.map((value, index) => ({
    x: left + (points.length <= 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1)),
    y: top + plotHeight - (value / maxValue) * plotHeight,
  }));
  const polyline = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `M ${coords[0].x.toFixed(1)} ${(height - bottom).toFixed(1)} L ${coords.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' L ')} L ${coords[coords.length - 1].x.toFixed(1)} ${(height - bottom).toFixed(1)} Z`;
  const grid = [0, 0.33, 0.66, 1].map((fraction) => {
    const y = top + plotHeight * fraction;
    const label = Math.round(maxValue * (1 - fraction));
    return `<line class="chart-grid-line" x1="${left}" y1="${y.toFixed(1)}" x2="${width-right}" y2="${y.toFixed(1)}"/><text class="chart-axis-label" x="${left-8}" y="${(y+4).toFixed(1)}" text-anchor="end">${label}</text>`;
  }).join('');
  const labelAt = (index) => {
    const value = String(points[index]?.date || '');
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const dots = coords.map((point, index) => `<circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${index === coords.length - 1 ? 4 : 2.5}"><title>${esc(points[index].date)}: ${values[index]} scans</title></circle>`).join('');
  $('#scanTrendChart').innerHTML = `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily scan activity over the last 14 days"><title>Scan activity over the last 14 days</title>${grid}<path class="chart-area" d="${area}"/><polyline class="chart-line" points="${polyline}"/>${dots}<text class="chart-date-label" x="${left}" y="${height-12}">${esc(labelAt(0))}</text><text class="chart-date-label" x="${width-right}" y="${height-12}" text-anchor="end">${esc(labelAt(points.length-1))}</text></svg>`;
}

function renderSeverityBreakdown(allCounts, openCounts) {
  const labels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Informational' };
  const values = Object.keys(labels).map((severity) => ({ severity, count: Number(allCounts?.[severity] || 0), open: Number(openCounts?.[severity] || 0) }));
  const maxCount = Math.max(1, ...values.map((item) => item.count));
  $('#severityBreakdown').innerHTML = values.map((item) => `<div class="severity-row">
    <div class="severity-label"><span class="badge ${item.severity}">${labels[item.severity]}</span><span class="severity-count">${formatInteger(item.count)}</span></div>
    <div class="severity-bar"><span class="severity-fill severity-${item.severity}" style="width:${Math.min(100, item.count / maxCount * 100).toFixed(1)}%"></span></div>
    <div class="severity-open">${formatInteger(item.open)} open</div>
  </div>`).join('');
}

function renderDashboard(data) {
  const totals = data.totals || {};
  $('#metricScans').textContent = formatInteger(totals.scans);
  $('#metricScansHint').textContent = `${formatInteger(totals.completed_scans)} completed · ${formatInteger(totals.failed_scans)} failed`;
  $('#metricActive').textContent = formatInteger(totals.active_scans);
  $('#metricTargets').textContent = formatInteger(totals.targets);
  $('#metricOpen').textContent = formatInteger(totals.open_findings);
  $('#metricCriticalHigh').textContent = formatInteger(totals.open_critical_high);
  $('#metricSuccess').textContent = `${Number(totals.success_rate_pct || 0).toFixed(1)}%`;
  $('#metricDuration').textContent = totals.average_duration_seconds == null ? 'No completed duration sample' : `${formatDuration(totals.average_duration_seconds)} · last ${formatInteger(totals.average_duration_sample_size)} completed`; 
  $('#metricCompleted').textContent = formatInteger(totals.completed_scans);
  $('#metricFailed').textContent = formatInteger(totals.failed_scans);
  renderTrendChart(data.scan_trend || []);
  renderSeverityBreakdown(data.findings_by_severity || {}, data.open_findings_by_severity || {});

  const recent = data.recent_scans || [];
  $('#recentScans').innerHTML = recent.length ? recent.map((scan) => `<article class="recent-scan-row">
    <div class="recent-scan-main"><span class="recent-scan-symbol">${scan.status === 'completed' ? '✓' : scan.status === 'failed' ? '!' : scan.status === 'running' ? '↻' : '◷'}</span><div class="recent-scan-copy"><button class="inline-link recent-target" type="button" data-recent-scan-id="${esc(scan.id)}">${esc(scan.target_url)}</button><div class="small">${esc((scan.profile || 'standard').toUpperCase())} · ${prettyDate(scan.created_at)}</div></div></div>
    <div class="recent-scan-meta"><span class="badge ${esc(scan.status)}">${esc(scan.status.toUpperCase())}</span><span class="small">${formatInteger(scan.finding_count)} findings</span></div>
  </article>`).join('') : '<div class="chart-empty"><b>No assessments recorded</b><span class="small">Start your first authorized assessment from the form above.</span></div>';
  document.querySelectorAll('[data-recent-scan-id]').forEach((button) => button.addEventListener('click', () => selectScan(button.dataset.recentScanId)));

  const risks = data.top_open_findings || [];
  $('#riskQueue').innerHTML = risks.length ? risks.map((finding) => `<article class="risk-row"><div class="risk-row-top"><span class="badge ${esc(finding.severity)}">${esc(finding.severity.toUpperCase())}</span><span class="risk-score">Risk ${Number(finding.risk_score || 0).toFixed(1)}</span></div><div class="risk-title">${esc(finding.title)}</div><div class="small risk-target">${esc(finding.target_url)}</div><div class="row risk-row-bottom"><code>${esc(finding.rule_id)}</code><button class="btn secondary small-btn" type="button" data-risk-scan-id="${esc(finding.scan_id)}">Review scan</button></div></article>`).join('') : '<div class="chart-empty"><span class="empty-mark">✓</span><b>No open findings in the queue</b><span class="small">This does not prove the absence of vulnerabilities.</span></div>';
  document.querySelectorAll('[data-risk-scan-id]').forEach((button) => button.addEventListener('click', () => selectScan(button.dataset.riskScanId)));

  const targets = data.top_targets || [];
  const maxScans = Math.max(1, ...targets.map((target) => Number(target.scan_count || 0)));
  $('#topTargets').innerHTML = targets.length ? targets.map((target) => `<div class="target-row"><div class="target-copy"><span class="target-url" title="${esc(target.target_url)}">${esc(target.target_url)}</span><div class="target-track"><span style="width:${Math.min(100, Number(target.scan_count || 0) / maxScans * 100).toFixed(1)}%"></span></div></div><div class="target-meta"><b>${formatInteger(target.scan_count)}</b><button class="inline-link" type="button" data-use-target="${esc(target.target_url)}">Use target</button></div></div>`).join('') : '<div class="chart-empty"><b>No target history yet</b><span class="small">Targets appear here after scans are created.</span></div>';
  document.querySelectorAll('[data-use-target]').forEach((button) => button.addEventListener('click', () => {
    $('#url').value = button.dataset.useTarget || '';
    $('#scanFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#url').focus({ preventScroll: true });
  }));
}

async function selectScan(scanId) {
  selectedScanId = scanId;
  renderScanList();
  try {
    await refreshDetail();
    $('#assessmentWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(error); }
}

function generatedDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

function exportDashboardJson() {
  if (!dashboardSummary) { $('#dashboardMessage').hidden = false; $('#dashboardMessage').textContent = 'Dashboard data is not loaded yet.'; return; }
  generatedDownload(`firewatch-dashboard-${new Date().toISOString().slice(0, 10)}.json`, `${JSON.stringify(dashboardSummary, null, 2)}\n`, 'application/json;charset=utf-8');
}

function exportDashboardCsv() {
  if (!dashboardSummary) { $('#dashboardMessage').hidden = false; $('#dashboardMessage').textContent = 'Dashboard data is not loaded yet.'; return; }
  const rows = [['section', 'metric', 'value']];
  for (const [key, value] of Object.entries(dashboardSummary.totals || {})) rows.push(['totals', key, value ?? '']);
  for (const [key, value] of Object.entries(dashboardSummary.scans_by_status || {})) rows.push(['scan_status', key, value]);
  for (const [key, value] of Object.entries(dashboardSummary.findings_by_severity || {})) rows.push(['finding_severity', key, value]);
  for (const point of dashboardSummary.scan_trend || []) rows.push(['scan_trend', point.date, point.count]);
  for (const scan of dashboardSummary.recent_scans || []) rows.push(['recent_scan', scan.target_url, `${scan.status}; findings=${scan.finding_count}; scan_id=${scan.id}`]);
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  generatedDownload(`firewatch-dashboard-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}\r\n`, 'text/csv;charset=utf-8');
}

function renderScanList() {
  const term = ($('#scanSearch')?.value || '').trim().toLowerCase();
  const status = $('#scanStatusFilter')?.value || '';
  const filtered = scanCache.filter((scan) => (!status || scan.status === status)
    && (!term || `${scan.target_url} ${scan.id}`.toLowerCase().includes(term)));
  $('#scanCount').textContent = `${filtered.length} shown · ${scanCache.length} jobs`;
  if (!filtered.length) {
    $('#scanList').innerHTML = `<div class="empty-filter-state">${scanCache.length ? 'No scan jobs match these filters.' : 'No scans yet. Create an assessment to begin.'}</div>`;
    return;
  }
  $('#scanList').innerHTML = filtered.map((scan) => `
    <button class="scan-row ${selectedScanId === scan.id ? 'active' : ''}" type="button" data-scan-id="${esc(scan.id)}">
      <div class="scan-row-target">${esc(scan.target_url)}</div>
      <div class="row scan-row-meta"><span class="badge ${esc(scan.status)}">${esc(scan.status.toUpperCase())}</span><span class="small">${prettyDate(scan.created_at)}</span></div>
    </button>`).join('');
  document.querySelectorAll('#scanList [data-scan-id]').forEach((button) => button.addEventListener('click', async () => {
    selectedScanId = button.dataset.scanId;
    renderScanList();
    try { await refreshDetail(); } catch (error) { showError(error); }
  }));
}

function renderFindingList() {
  const term = ($('#findingSearch')?.value || '').trim().toLowerCase();
  const severity = $('#findingSeverityFilter')?.value || '';
  const filtered = currentFindings.filter((finding) => (!severity || finding.severity === severity)
    && (!term || [finding.title, finding.rule_id, finding.endpoint, finding.category, finding.description].some((value) => String(value || '').toLowerCase().includes(term))));
  $('#findingCount').textContent = `${filtered.length} shown · ${currentFindings.length} findings`;
  $('#findings').innerHTML = filtered.length ? filtered.map((finding) => `
    <article class="finding"><div class="finding-head"><h3>${esc(finding.title)}</h3><span class="badge ${esc(finding.severity)}">${esc(finding.severity.toUpperCase())}</span></div>
      <div class="small">${esc(finding.rule_id)} · ${Math.round(Number(finding.confidence) * 100)}% confidence · risk ${esc(finding.risk_score)} · ${esc(finding.status)}</div>
      <p class="endpoint">${esc(finding.endpoint)}</p><p>${esc(finding.description)}</p><p><b>Impact:</b> ${esc(finding.impact)}</p><p><b>Evidence summary:</b> ${esc(finding.evidence_summary)}</p><p><b>Remediation:</b> ${esc(finding.remediation)}</p><p class="small">${esc((finding.references || []).join(' · '))}</p>
    </article>`).join('') : `<div class="empty-filter-state">${currentFindings.length ? 'No findings match these filters.' : 'No findings recorded for this scan.'}</div>`;
}

async function refreshDetail() {
  if (!selectedScanId) return;
  const scanId = selectedScanId;
  const [scan, findings, events, assets] = await Promise.all([
    api(`/scans/${scanId}`),
    api(`/scans/${scanId}/findings?limit=500`),
    api(`/scans/${scanId}/events?limit=500`),
    api(`/scans/${scanId}/assets?limit=300`),
  ]);
  if (selectedScanId !== scanId) return;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach((finding) => { if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1; });
  const latest = events.at(-1);
  const progress = Math.max(0, Math.min(100, Number(latest?.progress || 0)));
  $('#detailTitle').textContent = scan.target_url;
  currentFindings = findings;
  renderFindingList();
  $('#detail').innerHTML = `
    <div class="grid3">${Object.entries(counts).map(([severity, count]) => `<div class="metric"><span class="badge ${severity}">${severity.toUpperCase()}</span><strong>${count}</strong></div>`).join('')}</div>
    <div style="margin-top:14px"><div class="row"><span class="badge ${esc(scan.status)}">${esc(scan.status.toUpperCase())}</span><span class="small">Pages ${scan.pages_count} · Assets ${scan.assets_count} · Findings ${scan.findings_count} · Events ${scan.events_count}</span></div><div class="progress" style="margin-top:10px"><div style="width:${progress}%"></div></div><p class="small">${latest ? esc(`${latest.phase}: ${latest.message}`) : 'Waiting for scan events…'}</p>${scan.error ? `<p class="notice">${esc(scan.error)}</p>` : ''}</div>
    <div class="row action-row"><button class="btn secondary" data-report="html">HTML</button><button class="btn secondary" data-report="json">JSON</button><button class="btn secondary" data-report="csv">CSV</button><button class="btn secondary" data-report="markdown">Markdown</button><button class="btn secondary" data-report="sarif">SARIF</button><button class="btn secondary" id="downloadBundle">All reports ZIP</button><button class="btn secondary" id="showCoverage">Coverage</button><button class="btn secondary" id="showEvidence">Evidence</button><button class="btn secondary" id="compareScan">Compare baseline</button>${['queued', 'running'].includes(scan.status) ? '<button class="btn danger" id="cancelScan">Cancel scan</button>' : ''}</div>
    <details style="margin-top:14px"><summary>Execution timeline (${events.length})</summary><div class="table-wrap"><table class="table"><thead><tr><th>Phase</th><th>Progress</th><th>Event</th><th>Time</th></tr></thead><tbody>${events.map((event) => `<tr><td>${esc(event.phase)}</td><td>${esc(event.progress)}%</td><td>${esc(event.message)}</td><td>${prettyDate(event.created_at)}</td></tr>`).join('')}</tbody></table></div></details>
    <details style="margin-top:14px"><summary>Asset inventory (${assets.length} returned)</summary><div class="table-wrap"><table class="table"><thead><tr><th>Kind</th><th>Status</th><th>Method</th><th>URL</th></tr></thead><tbody>${assets.map((asset) => `<tr><td>${esc(asset.kind)}</td><td>${esc(asset.status_code ?? '—')}</td><td>${esc(asset.method)}</td><td class="endpoint">${esc(asset.url)}</td></tr>`).join('')}</tbody></table></div></details>`;
  document.querySelectorAll('[data-report]').forEach((button) => button.addEventListener('click', async () => {
    const format = button.dataset.report;
    const names = { html: 'report.html', json: 'report.json', csv: 'findings.csv', markdown: 'report.md', sarif: 'report.sarif.json' };
    try { await download(`/api/v1/scans/${scanId}/report?format=${encodeURIComponent(format)}`, names[format]); }
    catch (error) { showError(error); }
  }));
  $('#downloadBundle').addEventListener('click', async () => {
    try { await download(`/api/v1/scans/${scanId}/bundle`, `firewatch-${scanId}.zip`); }
    catch (error) { showError(error); }
  });
  $('#showCoverage').addEventListener('click', () => showCoverage(scanId));
  $('#showEvidence').addEventListener('click', () => showEvidence(scanId));
  $('#compareScan').addEventListener('click', () => compareScan(scanId));
  $('#cancelScan')?.addEventListener('click', async () => {
    try { await api(`/scans/${scanId}/cancel`, { method: 'POST' }); await refreshScans(); }
    catch (error) { showError(error); }
  });
}

async function showCoverage(scanId) {
  try {
    const result = await api(`/scans/${scanId}/coverage`);
    const rows = (result.catalog || []).map((item) => `<tr><td>${esc(item.category)}</td><td>${esc(item.status)}</td><td>${esc(item.finding_count ?? item.findings ?? 0)}</td><td>${esc(item.note || item.description || '')}</td></tr>`).join('');
    $('#detailPanel').innerHTML = `<p><b>Coverage interpretation:</b> ${esc(result.interpretation)}</p><p class="small">Pages: ${esc(result.pages_discovered)} · Assets: ${esc(result.assets_discovered)} · Findings: ${esc(result.findings_recorded)}</p><div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th>Status</th><th>Findings</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No catalog coverage rows returned.</td></tr>'}</tbody></table></div>`;
  } catch (error) { showError(error); }
}

async function showEvidence(scanId) {
  try {
    const items = await api(`/scans/${scanId}/evidence?limit=500`);
    $('#detailPanel').innerHTML = items.length ? `<p class="small">Evidence is returned after server-side redaction. Review before sharing outside your organization.</p><div class="table-wrap"><table class="table"><thead><tr><th>Finding ID</th><th>Kind</th><th>Evidence data</th><th>Created</th></tr></thead><tbody>${items.map((item) => `<tr><td>${esc(item.finding_id)}</td><td>${esc(item.kind)}</td><td><pre class="evidence-json">${esc(JSON.stringify(item.data, null, 2))}</pre></td><td>${prettyDate(item.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">No evidence records are available for this scan yet.</div>';
  } catch (error) { showError(error); }
}

async function compareScan(scanId) {
  try {
    const diff = await api(`/scans/${scanId}/diff`);
    const rows = (label, items) => items.length ? `<h3>${esc(label)} (${items.length})</h3><ul>${items.map((finding) => `<li>${esc(finding.severity?.toUpperCase())} · ${esc(finding.rule_id)} · ${esc(finding.title)} · ${esc(finding.endpoint)}</li>`).join('')}</ul>` : '';
    $('#detailPanel').innerHTML = `<p class="small">Baseline: ${esc(diff.baseline_scan_id || 'not available')} · Added ${diff.added.length} · Resolved ${diff.resolved.length} · Unchanged ${diff.unchanged.length}</p>${rows('New findings', diff.added)}${rows('Resolved candidates', diff.resolved)}${rows('Unchanged', diff.unchanged)}<p class="small">${esc(diff.message)}</p>`;
  } catch (error) { showError(error); }
}

function showError(error) {
  $('#msg').textContent = error?.message || String(error);
  $('#detailPanel').textContent = error?.message || String(error);
}

async function poll() {
  try { await Promise.allSettled([refreshScans(), loadDashboardSummary()]); }
  catch (error) { $('#msg').textContent = error.message; }
  pollTimer = window.setTimeout(poll, 3000);
}

render();
poll();
loadStandardsRegistry().catch(showStandardsError);
