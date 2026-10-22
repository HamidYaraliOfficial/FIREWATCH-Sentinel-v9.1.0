# FIREWATCH Dashboard / Sentinel 9.1.0

Dependency-free responsive HTML/CSS/JavaScript dashboard served by FastAPI; no Node build is required. It includes:

- Executive overview with live scan, target, finding and risk KPIs.
- 14-day scan trend, severity/open-finding distribution, recent assessments, risk queue and most-assessed targets.
- Scan creation with profile/scope/credential controls, status queue filtering, scan detail and cancellation.
- Finding search/severity filters, timeline, asset inventory, coverage, redacted evidence, baseline diff, and HTML/JSON/CSV/Markdown/SARIF/ZIP report downloads.
- Live standards/assurance checklist, audit history, filters and CSV/Excel exports.
- Dashboard CSV/JSON export, printer-friendly styling, API/readiness status, mobile layouts and keyboard focus indicators.

The dashboard requests aggregate metrics from `GET /api/v1/dashboard/summary`; that endpoint is protected by the same `X-API-Key` setting as other application APIs. If `FIREWATCH_API_KEY` is configured, enter it and select **Use key**. It is kept in browser `sessionStorage` for the current tab only; **Forget key** removes it from that tab. Do not use the dashboard over an untrusted network without HTTPS and access controls. All scan operations must remain within a documented, authorized scope.
