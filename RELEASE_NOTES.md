# FIREWATCH Sentinel v9.1.0 — Dashboard and Operations Update

FIREWATCH Sentinel is an evidence-driven, scope-controlled platform for authorized web application security assessment. Version 9.1.0 adds a management-oriented, responsive dashboard that displays real aggregate data from the existing database while preserving the existing scan console and standards assurance workspace.

## Changes in v9.1.0

- **Executive dashboard:** scan totals, active jobs, distinct targets, open findings, open critical/high findings, completion rate and average duration.
- **Visual operations panels:** 14-day activity trend, severity distribution, recent assessments, prioritized open-risk queue and most-assessed targets.
- **Triage workflow:** search/filter scan jobs by target and status; search/filter the selected scan's findings by text and severity; open scan details from dashboard shortcuts.
- **Operational status:** API and database readiness chip, manual refresh, last-updated time and explicit API-key clearing from the current browser tab.
- **Exports:** dashboard CSV and JSON download, print stylesheet for browser PDF output; existing per-scan HTML/JSON/CSV/Markdown/SARIF and ZIP report downloads remain available.
- **Responsive/accessibility:** tablet/mobile breakpoints, horizontal-overflow reduction, skip link, primary navigation, keyboard focus visibility and reduced-motion preference.
- **Protected aggregation API:** `GET /api/v1/dashboard/summary` computes aggregate-only metrics and a bounded 14-day trend. The response excludes raw scan configuration, secrets, evidence and finding descriptions.
- **Regression tests:** dashboard API aggregation, status/severity counts, trend, target ranking, critical risk ordering, key enforcement and secret non-disclosure.

## Safety and deployment notes

- Scan only assets covered by explicit authorization and a written scope.
- Automated findings require validation; no finding and a completed scan do not prove the application is secure.
- The existing API-key gate remains a shared API gate, not a tenant identity system or resource-level RBAC. Use HTTPS and network access controls for deployments.
- The dashboard aggregates all scans stored by the current application instance. It is not a multi-tenant isolation boundary.
- The standards workbook is still an offline snapshot; use the live checklist UI/API for database-backed project state.
