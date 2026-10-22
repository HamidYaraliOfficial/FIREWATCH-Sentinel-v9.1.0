# FIREWATCH Sentinel v9.1.0 — Verification Record

Verification date: 2026-10-21

## Release scope

Version 9.1.0 adds a responsive management dashboard backed by a protected aggregate API endpoint (`GET /api/v1/dashboard/summary`). The overview includes KPI cards, a 14-day scan trend, severity/open-risk breakdowns, recent scan shortcuts, highest-risk open findings, frequently assessed targets, API readiness, scan/finding filters, CSV and JSON export, and print-to-PDF styling. The endpoint reports calculated aggregates and summary fields; it does not serialize the raw scan configuration, authentication-cookie configuration, or evidence payloads.

## Local test results

- Collected and executed **5,951 pytest cases across 63 test modules**. The latest complete backend suite completed without failures.
- The complete 8-shard coverage gate completed: **84.82% statement coverage**, above the configured **80% minimum**, with **0 failures** and **0 skipped cases** reported by that gate.
- New dashboard regression tests passed for database-backed aggregation, severity counts, the 14-day trend, risk ordering, target rollups, API-key enforcement, credential/config non-disclosure, and responsive static assets.
- Additional targeted API tests passed, including legacy scan flows.
- Browser smoke test was run with Playwright/Chromium against a locally rendered dashboard and a mocked API response. At desktop width **1440 px** and mobile width **390 px**, the dashboard rendered six KPI cards, severity breakdown rows and recent scans; there were **0 JavaScript page/console errors** and **0 horizontal overflow**. API health and summary UI state were verified with the mock. The backend endpoint itself was tested separately with FastAPI `TestClient` and an isolated SQLite database; the browser test was not an end-to-end test against a live backend.
- Python compilation (`compileall`), dashboard JavaScript syntax (`node --check`), publisher shell syntax (`bash -n`), Docker Compose YAML parsing, repository hygiene, assessment-plan export, test-manifest generation, declared dependency inventory export, and report-bundle manifest verification passed.
- `examples/demo_scan/report-bundle.zip` passed `scripts/verify_report_bundle.py`, including manifest path, size and SHA-256 checks. This validates consistency with the embedded manifest, not publisher authenticity.
- The assessment plan contains 79 cases (22 passive automated observations, 13 automated review candidates, 38 manual/test-account cases and 6 specialist-tool cases). These are planned target-assessment activities, not all executed automated checks.

## Not run or not independently verified

- Bandit and `pip-audit` were not available in the active environment; no successful independent static security or dependency vulnerability audit is claimed.
- Docker CLI was not available, so container image build and Compose runtime deployment could not be tested.
- Hosted CI/GitHub Actions, hosted CodeQL, production PostgreSQL behavior, live-target browser execution and a full ZAP scan were not run.
- The installed Python/package environment does not exactly match every repository-pinned dependency version. Re-run the release suite under the exact pinned dependency set in CI before deploying.
- The generated dependency inventory is based on declared requirements. It is not a resolved SBOM or a vulnerability audit. The report manifest is not a digital signature or proof of publisher identity.

## Remaining production risks and gates

- The shared API key is not multi-tenant identity or resource-level RBAC/ABAC; `project_key` is a partitioning value, not a security boundary.
- The default HTTP transport pins each TCP connection to validated IP addresses. Playwright and optional external tools have separate network stacks; enforce outbound firewall/proxy allow-lists and isolated scanning networks.
- The database uses `create_all()` and has no versioned Alembic migration framework. Existing installations need an explicit, rehearsed migration/rollback procedure, including the `worker_leases` table.
- Worker heartbeats and stale-job recovery are implemented: an expired lease or legacy stale `RUNNING` record is failed with an audit event rather than automatically replayed. Automatic retry ceilings and exactly-once report publication remain incomplete.
- The ZAP adapter writes a passive Automation Framework plan and checks reachability; it does not automatically run a complete ZAP scan or import ZAP alerts.
- Production secret-manager/KMS integration and rotation, resolved SBOM, supply-chain signing/provenance, observability/alerting, backup/restore drills and independent penetration testing remain open deployment gates.

This package is a hardened, scope-controlled assessment tool, not defect-free or certified software. A lack of findings is not proof that a target is secure or compliant.
