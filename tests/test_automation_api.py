"""Tests for Ticket Automation & Auto-Closure APIs:
1. Incident automated resolution and auto-closure batch endpoint.
2. Service Request automated fulfillment and auto-closure batch endpoint.
3. Change Request automated completion and closure.
"""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_incident_direct_auto_resolution(client):
    """External automation bot creates an incident and immediately auto-resolves it."""
    # 1. External monitoring tool logs an incident
    create_res = client.post("/api/incidents", json={
        "caller_id": 2,
        "application_id": 1,
        "project_id": 1,
        "category": "Application",
        "short_description": "Auto-detected high memory on pod-svc-payment",
        "description": "Triggered by Prometheus alert memory > 90%",
        "impact": "Medium",
        "urgency": "High"
    }, headers={"X-User-ID": "1"})
    assert create_res.status_code == 200
    inc = create_res.json()
    inc_num = inc["number"]
    assert inc["status"] == "New"

    # 2. Auto-remediation script restarts pod and resolves incident directly
    resolve_res = client.patch(f"/api/incidents/{inc_num}/status", json={
        "status": "Resolved",
        "resolution_code": "Automated Remediation",
        "resolution_notes": "Pod restarted automatically by Kubernetes operator. Memory usage returned to 22%.",
        "close_category": "Infrastructure Limitation"
    }, headers={"X-User-ID": "1"})
    assert resolve_res.status_code == 200
    resolved = resolve_res.json()
    assert resolved["status"] == "Resolved"
    assert resolved["resolution_code"] == "Automated Remediation"
    assert "restarted automatically" in resolved["resolution_notes"]

    # 3. Add automated work note
    note_res = client.post(f"/api/incidents/{inc_num}/work-notes", json={
        "note": "Operator trace ID: k8s-exec-89127391. Health check confirmed 200 OK."
    }, headers={"X-User-ID": "1"})
    assert note_res.status_code == 200


def test_incident_auto_close_batch_api(client):
    """External scheduler/cron calls the auto-close endpoint to close resolved tickets."""
    # 1. Create and resolve an incident
    create_res = client.post("/api/incidents", json={
        "caller_id": 2,
        "application_id": 1,
        "project_id": 1,
        "category": "Application",
        "short_description": "Network latency spike",
        "description": "Transient latency observed in eu-west-1",
        "impact": "Low",
        "urgency": "Low"
    }, headers={"X-User-ID": "1"})
    assert create_res.status_code == 200
    inc_num = create_res.json()["number"]

    # Resolve it
    client.patch(f"/api/incidents/{inc_num}/status", json={
        "status": "Resolved",
        "resolution_code": "Self-Corrected",
        "resolution_notes": "AWS network issue resolved"
    }, headers={"X-User-ID": "1"})

    # 2. Invoke batch auto-close with 0 hours (immediate test)
    autoclose_res = client.post("/api/incidents/auto-close", json={
        "hours_in_resolved": 0,
        "close_notes": "Automatically closed by nightly IT automation job",
        "dry_run": False
    }, headers={"X-User-ID": "1"})
    assert autoclose_res.status_code == 200
    res_data = autoclose_res.json()
    assert res_data["status"] == "success"
    assert res_data["auto_closed_count"] >= 1
    assert inc_num in res_data["auto_closed_tickets"]

    # 3. Verify incident is now Closed
    get_res = client.get(f"/api/incidents/{inc_num}", headers={"X-User-ID": "1"})
    assert get_res.status_code == 200
    assert get_res.json()["status"] == "Closed"


def test_service_request_auto_fulfillment_and_closure(client):
    """External IAM automation bot fulfills access request and auto-closes it."""
    # 1. User requests database read access
    create_res = client.post("/api/service-requests", json={
        "catalog_item": "Standard Developer Tools",
        "short_description": "Request IDE License",
        "description": "Need VSCode plugin license",
        "application_id": 1,
        "project_id": 1,
        "priority": "P3"
    }, headers={"X-User-ID": "2"})
    assert create_res.status_code == 200
    req = create_res.json()
    req_num = req["number"]

    # 2. External automation provisions license and marks Fulfilled
    fulfill_res = client.patch(f"/api/service-requests/{req_num}/status", json={
        "status": "Fulfilled",
        "reason": "License provisioned automatically via License Manager API"
    }, headers={"X-User-ID": "1"})
    assert fulfill_res.status_code == 200
    assert fulfill_res.json()["status"] == "Fulfilled"

    # 3. Batch auto-close fulfilled requests
    autoclose_res = client.post("/api/service-requests/auto-close", json={
        "hours_in_fulfilled": 0,
        "close_notes": "Auto-closed after fulfillment"
    }, headers={"X-User-ID": "1"})
    assert autoclose_res.status_code == 200
    assert req_num in autoclose_res.json()["auto_closed_tickets"]

    # 4. Confirm ticket status is Closed
    get_res = client.get(f"/api/service-requests/{req_num}", headers={"X-User-ID": "1"})
    assert get_res.status_code == 200
    assert get_res.json()["status"] == "Closed"


def test_change_request_automated_progression(client):
    """CI/CD automation pipeline updates change request through implementation to Closed."""
    # 1. Create standard change
    create_res = client.post("/api/changes", json={
        "application_id": 1,
        "project_id": 1,
        "change_type": "Standard",
        "category": "Software",
        "short_description": "Automated deployment v3.2.1 to production",
        "description": "Release pipeline triggered by git tag v3.2.1",
        "business_justification": "Routine sprint release",
        "risk": "Low",
        "impact": "Low",
        "priority": "P3"
    }, headers={"X-User-ID": "1"})
    assert create_res.status_code == 200
    chg = create_res.json()
    chg_num = chg["number"]
    assert chg["change_status"] == "Scheduled"

    # 2. CI/CD pipeline starts: moves to Implementation
    client.patch(f"/api/changes/{chg_num}/status", json={
        "change_status": "Implementation",
        "reason": "GitLab CI runner deployed manifest"
    }, headers={"X-User-ID": "1"})

    # 3. Post-deployment smoke tests succeed: moves directly to Completed
    client.patch(f"/api/changes/{chg_num}/status", json={
        "change_status": "Completed",
        "reason": "Synthetic smoke tests 100% passed"
    }, headers={"X-User-ID": "1"})

    # 4. CI/CD pipeline closes change
    close_res = client.patch(f"/api/changes/{chg_num}/status", json={
        "change_status": "Closed",
        "reason": "Automated deployment lifecycle finished successfully"
    }, headers={"X-User-ID": "1"})
    assert close_res.status_code == 200
    assert close_res.json()["change_status"] == "Closed"


def test_swagger_and_automation_openapi_exposure(client):
    """Verify Swagger UI and OpenAPI documentation are properly exposed for ticket automation."""
    # 1. Root and Subpath Swagger UI endpoints
    docs_res = client.get("/docs")
    assert docs_res.status_code == 200
    assert "Swagger UI" in docs_res.text
    assert "/vendor/swagger/swagger-ui-bundle.js" in docs_res.text
    assert "/vendor/swagger/swagger-ui.css" in docs_res.text
    assert "<script>" not in docs_res.text
    csp = docs_res.headers.get("content-security-policy", "")
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "font-src 'self' data:;" in csp
    assert "cdn.jsdelivr.net" not in csp

    itsm_docs_res = client.get("/itsm/docs")
    assert itsm_docs_res.status_code == 200
    assert "Swagger UI" in itsm_docs_res.text
    assert "/itsm/vendor/swagger/swagger-ui-bundle.js" in itsm_docs_res.text

    # 2. OpenAPI Schema endpoints
    openapi_res = client.get("/openapi.json")
    assert openapi_res.status_code == 200
    schema = openapi_res.json()
    assert schema["info"]["title"] == "GenWizard Support Portal"
    assert schema["info"].get("description", "") == ""

    # Security Schemes
    sec_schemes = schema.get("components", {}).get("securitySchemes", {})
    assert "BearerAuth" in sec_schemes
    assert "ApiKeyAuth" in sec_schemes

    # Ticket Automation Paths
    paths = schema.get("paths", {})
    assert "/api/incidents" in paths
    assert "/api/incidents/{ticket_id_or_number}/status" in paths
    assert "/api/incidents/{ticket_id_or_number}/work-notes" in paths
    assert "/api/incidents/auto-close" in paths
    assert "/api/service-requests" in paths
    assert "/api/service-requests/{ticket_id_or_number}/status" in paths
    assert "/api/service-requests/auto-close" in paths
    assert "/api/changes" in paths
    assert "/api/changes/{ticket_id_or_number}/status" in paths

    # 3. Subpath OpenAPI endpoint
    itsm_openapi_res = client.get("/itsm/openapi.json")
    assert itsm_openapi_res.status_code == 200


def test_redirects_and_routes_csp_compliance(client):
    """Verify that all application redirects and routes include clean CSP headers with no invalid font-src blob."""
    # 1. /itsm redirect
    itsm_redirect = client.get("/itsm", follow_redirects=False)
    assert itsm_redirect.status_code == 307
    csp = itsm_redirect.headers.get("content-security-policy", "")
    assert "font-src 'self' data:;" in csp
    assert "font-src 'self' data: blob:;" not in csp
    assert "blob:" not in csp.split("font-src")[1].split(";")[0]

    # 2. ReDoc endpoints
    redoc_res = client.get("/redoc")
    assert redoc_res.status_code == 200
    assert "<script>" not in redoc_res.text
    assert "<style>" not in redoc_res.text
    assert "/vendor/swagger/redoc-custom.css" in redoc_res.text
    assert "/vendor/swagger/redoc.standalone.js" in redoc_res.text

    itsm_redoc = client.get("/itsm/redoc")
    assert itsm_redoc.status_code == 200
    assert "<script>" not in itsm_redoc.text
    assert "<style>" not in itsm_redoc.text

    # 3. Index route
    idx_res = client.get("/", follow_redirects=False)
    assert idx_res.status_code == 200
    csp_idx = idx_res.headers.get("content-security-policy", "")
    assert "font-src 'self' data:;" in csp_idx
    assert "blob:" not in csp_idx.split("font-src")[1].split(";")[0]


def test_identity_service_docs_and_csp():
    """Verify that the Identity Management microservice also uses self-hosted Swagger with no inline scripts and clean CSP."""
    from fastapi.testclient import TestClient
    from identity_service.main import app as identity_app
    im_client = TestClient(identity_app)

    # 1. /docs on Identity service
    im_docs = im_client.get("/docs")
    assert im_docs.status_code == 200
    assert "Genwizard Identity Management — Swagger UI" in im_docs.text
    assert "/vendor/swagger/swagger-ui-bundle.js" in im_docs.text
    assert "<script>" not in im_docs.text
    assert "<style>" not in im_docs.text
    im_csp = im_docs.headers.get("content-security-policy", "")
    assert "font-src 'self' data:;" in im_csp
    assert "blob:" not in im_csp.split("font-src")[1].split(";")[0]

    # 2. /api/id/docs
    im_subdocs = im_client.get("/api/id/docs")
    assert im_subdocs.status_code == 200
    assert "<script>" not in im_subdocs.text

    # 3. OpenAPI schema
    im_openapi = im_client.get("/openapi.json")
    assert im_openapi.status_code == 200
    assert "Genwizard ITSM — Enterprise Identity Management Service" in im_openapi.json()["info"]["title"]


