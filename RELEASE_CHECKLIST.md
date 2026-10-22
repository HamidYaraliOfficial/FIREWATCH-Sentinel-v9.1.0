# FIREWATCH Sentinel v9.1.0 Release Checklist

- [x] `VERSION`, backend version metadata, package metadata and current dashboard documentation align to `9.1.0`.
- [x] Added protected aggregate endpoint `GET /api/v1/dashboard/summary`.
- [x] Dashboard uses actual database aggregates and does not serialize raw scan configuration or secret values.
- [x] Added responsive overview, scan activity trend, severity bars, recent scan shortcuts, open-risk queue and target portfolio.
- [x] Added scan/finding filters, API readiness indicator, CSV/JSON exports and print stylesheet.
- [x] Added dashboard API tests including authorization and credential non-disclosure.
- [x] Current local backend suite: 5,951 cases across 63 modules, no failures.
- [x] Complete 8-shard coverage gate: 84.82% statement coverage against an 80% minimum.
- [x] Playwright desktop/mobile dashboard smoke test with mocked API: no JavaScript errors or horizontal overflow.
- [ ] Re-run the complete release verification suite under the exact pinned dependency set in CI.
- [ ] Run the Docker image build, compose deployment and browser test in the deployment environment.
- [ ] Configure HTTPS, strong API key, restricted ingress, outbound network policy and database backups before production use.
- [ ] Complete the separately documented RBAC/multi-tenant, database migration and browser-egress production gates.

> Passing software tests and coverage thresholds do not prove that the application or scanned targets are vulnerability-free or compliant with a standard.
