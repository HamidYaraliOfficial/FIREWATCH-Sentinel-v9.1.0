from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db
from app.main import app
from app.models import Finding, FindingStatus, Scan, ScanStatus, Severity


def _isolated_database(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'dashboard.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    test_sessions = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    def override_db():
        db = test_sessions()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setitem(app.dependency_overrides, get_db, override_db)
    return engine, test_sessions


def test_dashboard_summary_aggregates_real_scan_and_finding_rows(tmp_path, monkeypatch):
    engine, test_sessions = _isolated_database(tmp_path, monkeypatch)
    now = datetime.now(timezone.utc)
    hidden_cookie_fixture = "COOKIE" + "_FIXTURE_VALUE_NOT_FOR_OUTPUT"
    try:
        with test_sessions() as db:
            complete = Scan(
                target_url="https://target.example/",
                status=ScanStatus.COMPLETED,
                config={"profile": "comprehensive", "auth_cookies": hidden_cookie_fixture},
                created_at=now - timedelta(minutes=10),
                started_at=now - timedelta(minutes=9),
                finished_at=now - timedelta(minutes=8),
            )
            running = Scan(
                target_url="https://target.example/",
                status=ScanStatus.RUNNING,
                config={"profile": "standard"},
                created_at=now - timedelta(minutes=2),
                started_at=now - timedelta(minutes=1),
            )
            failed = Scan(
                target_url="https://other.example/",
                status=ScanStatus.FAILED,
                config={"profile": "baseline"},
                created_at=now - timedelta(minutes=1),
            )
            db.add_all([complete, running, failed])
            db.flush()

            def finding(scan, *, title, severity, status, risk, key):
                return Finding(
                    scan_id=scan.id,
                    rule_id=f"TEST-{key.upper()}",
                    category="configuration",
                    title=title,
                    severity=severity,
                    confidence=0.95,
                    risk_score=risk,
                    status=status,
                    endpoint=scan.target_url,
                    description="Synthetic test finding",
                    impact="Synthetic test impact",
                    remediation="Synthetic test remediation",
                    references=[],
                    evidence_summary="Synthetic evidence",
                    dedupe_key=key,
                    created_at=now,
                )

            db.add_all([
                finding(complete, title="Critical open", severity=Severity.CRITICAL,
                        status=FindingStatus.OPEN, risk=95.0, key="critical"),
                finding(running, title="High open", severity=Severity.HIGH,
                        status=FindingStatus.OPEN, risk=80.0, key="high"),
                finding(failed, title="Low accepted", severity=Severity.LOW,
                        status=FindingStatus.ACCEPTED, risk=10.0, key="low"),
            ])
            db.commit()

        with TestClient(app) as client:
            response = client.get("/api/v1/dashboard/summary")
        assert response.status_code == 200
        body = response.json()
        assert body["window_days"] == 14
        assert body["totals"]["scans"] == 3
        assert body["totals"]["targets"] == 2
        assert body["totals"]["active_scans"] == 1
        assert body["totals"]["completed_scans"] == 1
        assert body["totals"]["failed_scans"] == 1
        assert body["totals"]["findings"] == 3
        assert body["totals"]["open_findings"] == 2
        assert body["totals"]["open_critical_high"] == 2
        assert body["findings_by_severity"] == {"critical": 1, "high": 1, "medium": 0, "low": 1, "info": 0}
        assert body["open_findings_by_severity"]["critical"] == 1
        assert len(body["scan_trend"]) == 14
        assert sum(point["count"] for point in body["scan_trend"]) == 3
        assert body["top_targets"][0] == {"target_url": "https://target.example/", "scan_count": 2}
        assert body["top_open_findings"][0]["title"] == "Critical open"
        assert len(body["recent_scans"]) == 3
        assert hidden_cookie_fixture not in response.text
        assert "auth_cookies" not in response.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_dashboard_summary_is_protected_when_api_key_is_configured(monkeypatch):
    from dataclasses import replace
    import app.main as main_module

    test_key = "-".join(("dashboard", "fixture", "key"))
    monkeypatch.setattr(main_module, "settings", replace(main_module.settings, api_key=test_key, environment="development"))
    with TestClient(app) as client:
        assert client.get("/api/v1/dashboard/summary").status_code == 401
        response = client.get("/api/v1/dashboard/summary", headers={"X-API-Key": test_key})
        assert response.status_code == 200
        assert response.json()["window_days"] == 14


def test_dashboard_static_includes_responsive_summary_controls():
    with TestClient(app) as client:
        html = client.get("/").text
        css = client.get("/static/app.css").text
        js = client.get("/static/app.js").text
    assert 'id="overviewPanel"' in html or "overviewPanel" in js
    assert "overview-metrics" in js
    assert "@media(max-width:560px)" in css
    assert "/dashboard/summary" in js
    assert "exportDashboardCsv" in js
