import pytest
import datetime
from backend.mongo_dal import MongoSession, InMemoryDatabase
from backend.models import (
    User, Application, Project, AssignmentGroup, GroupMember,
    ProjectAssignmentMapping, RoutingRule, BusinessCalendar,
    SLAPolicy, SLAInstance, Incident, ServiceRequest, ChangeRequest, TicketWorkNote, TicketComment
)
from backend.routing_engine import RoutingEngine, calculate_priority
from backend.sla_engine import SLAEngine
from backend.workflow_engine import WorkflowEngine
from backend.ai_copilot import EnterpriseKnowledgeFallback

@pytest.fixture(scope="function")
def test_db():
    mem_db = InMemoryDatabase("test_engine_db")
    db = MongoSession(mem_db)

    # Seed basic entities for tests
    cal = BusinessCalendar(
        name="Standard India Hours",
        timezone="Asia/Kolkata",
        working_days="[1, 2, 3, 4, 5]",
        working_hours_start="09:00",
        working_hours_end="18:00",
        holidays='["2026-08-15"]'
    )
    db.add(cal)
    db.flush()

    grp_desk = AssignmentGroup(group_id="GRP0", name="Service Desk", active=True)
    grp_app = AssignmentGroup(group_id="GRP1", name="Payment Application Support", active=True)
    grp_db = AssignmentGroup(group_id="GRP2", name="Database Support", active=True)
    db.add_all([grp_desk, grp_app, grp_db])
    db.flush()

    app = Application(
        app_id="APP1",
        name="Payment Gateway",
        default_assignment_group_id=grp_app.id,
        active=True
    )
    db.add(app)
    db.flush()

    proj = Project(
        project_id="PRJ1",
        name="Payment Modernization",
        application_id=app.id,
        default_assignment_group_id=grp_app.id,
        active=True
    )
    db.add(proj)
    db.flush()

    # Explicit routing rule
    rule_db = RoutingRule(
        rule_code="R1021",
        name="Database Category Rule",
        priority_order=10,
        category="Database",
        assignment_group_id=grp_db.id,
        active=True
    )
    db.add(rule_db)

    # SLA Policy v1
    sla_v1 = SLAPolicy(
        policy_code="SLA101",
        name="Critical App SLA",
        version=1,
        priority="P1",
        response_target_mins=15,
        resolution_target_mins=240, # 4h
        business_calendar_id=cal.id,
        effective_from=datetime.datetime(2025, 1, 1),
        effective_to=datetime.datetime(2026, 12, 31),
        active=True
    )
    # SLA Policy v2 (effective from 2027)
    sla_v2 = SLAPolicy(
        policy_code="SLA101",
        name="Critical App SLA",
        version=2,
        priority="P1",
        response_target_mins=15,
        resolution_target_mins=120, # 2h
        business_calendar_id=cal.id,
        effective_from=datetime.datetime(2027, 1, 1),
        effective_to=None,
        active=True
    )
    db.add_all([sla_v1, sla_v2])
    db.commit()

    yield db
    db.close()

def test_priority_matrix_calculation():
    assert calculate_priority("Critical", "Critical") == "P1"
    assert calculate_priority("Critical", "High") == "P1"
    assert calculate_priority("High", "High") == "P1"
    assert calculate_priority("Critical", "Medium") == "P2"
    assert calculate_priority("Medium", "Medium") == "P3"
    assert calculate_priority("Low", "Low") == "P4"

def test_routing_engine_hierarchy(test_db):
    app = test_db.query(Application).first()
    proj = test_db.query(Project).first()

    # Tier 1: Explicit Category Rule (Database -> Database Support)
    res1 = RoutingEngine.resolve_assignment_group(test_db, app.id, proj.id, category="Database")
    assert res1["level"] == 1
    assert res1["assignment_group_name"] == "Database Support"
    assert res1["rule_code"] == "R1021"

    # Tier 4: Project Default when no explicit rule
    res2 = RoutingEngine.resolve_assignment_group(test_db, app.id, proj.id, category="General Inquiry")
    assert res2["level"] == 4
    assert res2["assignment_group_name"] == "Payment Application Support"

    # Tier 6: Global Default Fallback
    res3 = RoutingEngine.resolve_assignment_group(test_db, None, None, category="Unknown")
    assert res3["level"] == 6
    assert "Service Desk" in res3["assignment_group_name"]

def test_sla_versioning_and_effective_dates(test_db):
    # In 2026: should match v1 (4 hours)
    date_2026 = datetime.datetime(2026, 6, 1)
    sla_2026 = SLAEngine.resolve_sla_policy(test_db, priority="P1", creation_time=date_2026)
    assert sla_2026["policy"].version == 1
    assert sla_2026["policy"].resolution_target_mins == 240

    # In 2027: should match v2 (2 hours)
    date_2027 = datetime.datetime(2027, 2, 1)
    sla_2027 = SLAEngine.resolve_sla_policy(test_db, priority="P1", creation_time=date_2027)
    assert sla_2027["policy"].version == 2
    assert sla_2027["policy"].resolution_target_mins == 120

def test_sla_pause_and_resume(test_db):
    policy = test_db.query(SLAPolicy).filter(SLAPolicy.version == 1).first()
    resp_inst, res_inst = SLAEngine.start_sla_instances(test_db, 100, "INC0001001", "Incident", policy)
    assert res_inst.stage == "in_progress"

    # Move to Pending Customer -> pauses resolution SLA
    SLAEngine.handle_status_change(test_db, 100, "Incident", "In Progress", "Pending Customer", "Awaiting user logs")
    assert res_inst.stage == "paused"
    assert res_inst.paused_at is not None

    # Move back to In Progress -> resumes
    SLAEngine.handle_status_change(test_db, 100, "Incident", "Pending Customer", "In Progress", "Logs provided")
    assert res_inst.stage == "in_progress"

    # Move to Resolved -> achieves
    SLAEngine.handle_status_change(test_db, 100, "Incident", "In Progress", "Resolved", "Fixed")
    assert res_inst.stage == "achieved"
    assert res_inst.achieved_at is not None

def test_workflow_engine_transitions():
    valid, _ = WorkflowEngine.validate_transition("Incident", "New", "In Progress")
    assert valid is True

    valid, _ = WorkflowEngine.validate_transition("Incident", "Closed", "In Progress")
    assert valid is False

def test_enterprise_ai_fallback():
    resp, cites = EnterpriseKnowledgeFallback.generate_response(
        "Payment gateway returning 502 bad gateway error",
        {"application": "Payment Gateway", "short_description": "Payment API 502"}
    )
    assert "kubectl get pods" in resp
    assert len(cites) > 0

def test_ai_copilot_cross_project_capabilities():
    resp, cites = EnterpriseKnowledgeFallback.generate_response(
        "will it be able to read all the incidents, request and worknotes everything across the projects to get relevant info ? what it will do exactly"
    )
    assert "Yes, absolutely" in resp
    assert "ticket_work_notes" in resp
    assert "Cross-Project" in resp
    assert len(cites) > 0

def test_ai_copilot_work_notes_synthesis(test_db):
    user = User(username="support_eng", full_name="Support Engineer", role="support")
    test_db.add(user)
    test_db.flush()

    inc = Incident(
        number="INC0009999",
        caller_id=user.id,
        application_id=1,
        project_id=1,
        short_description="Redis connection timeouts during batch job",
        description="Application pods timing out connecting to Redis cluster.",
        priority="P1",
        assignment_group_id=1,
        assigned_to_id=user.id,
        status="In Progress"
    )
    test_db.add(inc)
    test_db.flush()

    note = TicketWorkNote(
        ticket_type="incident",
        ticket_id=inc.id,
        user_id=user.id,
        note="Identified rogue cron job flushing keyspace every 5 minutes. Killed rogue PID 44102."
    )
    test_db.add(note)
    test_db.flush()

    resp, cites = EnterpriseKnowledgeFallback.generate_response(
        f"summarize ticket {inc.number}",
        db=test_db
    )
    assert "INC0009999" in resp
    assert "Redis connection timeouts" in resp
    assert "Killed rogue PID 44102" in resp
    assert any(c["url"] == f"#/incidents/{inc.number}" for c in cites)

def test_ai_copilot_summarize_change_and_request_with_comments_and_close_notes(test_db):
    user = User(username="lead_dev", full_name="Lead Developer", role="support")
    test_db.add(user)
    test_db.flush()

    # 1. Service Request with comments and work notes
    req = ServiceRequest(
        number="REQ0008888",
        requested_by_id=user.id,
        application_id=1,
        project_id=1,
        catalog_item="Database Access Provisioning",
        short_description="Request read-replica access for analytics team",
        description="Analytics team requires read-only user on replica.",
        priority="P3",
        assignment_group_id=1,
        assigned_to_id=user.id,
        status="In Progress"
    )
    test_db.add(req)
    test_db.flush()

    req_note = TicketWorkNote(
        ticket_type="request",
        ticket_id=req.id,
        user_id=user.id,
        note="Generated IAM temporary credentials with ReadOnlyAccess policy."
    )
    req_comm = TicketComment(
        ticket_type="request",
        ticket_id=req.id,
        user_id=user.id,
        comment="Please confirm if the credentials work from your bastion host."
    )
    test_db.add_all([req_note, req_comm])
    test_db.flush()

    resp_req, cites_req = EnterpriseKnowledgeFallback.generate_response(
        f"summarize {req.number}",
        db=test_db
    )
    assert "REQ0008888" in resp_req
    assert "ReadOnlyAccess" in resp_req
    assert "bastion host" in resp_req
    assert any(c["url"] == f"#/service-requests/{req.number}" for c in cites_req)

    # 2. Change Request with plans and closure notes
    chg = ChangeRequest(
        number="CHG0007777",
        requested_by_id=user.id,
        application_id=1,
        project_id=1,
        change_type="Normal",
        short_description="Upgrade Redis cluster to v7.2",
        description="Major version upgrade of caching infrastructure.",
        business_justification="Security patches and performance optimization.",
        priority="P2",
        assignment_group_id=1,
        assigned_to_id=user.id,
        implementation_plan="1. Snapshot current dataset. 2. Failover to secondary. 3. Upgrade primary.",
        backout_plan="Revert DNS pointer to v7.0 standby replica.",
        test_plan="Execute smoke test suite against synthetic workload.",
        closure_notes="Upgrade completed with 0 dropped packets. All telemetry nominal.",
        change_status="Closed"
    )
    test_db.add(chg)
    test_db.flush()

    resp_chg, cites_chg = EnterpriseKnowledgeFallback.generate_response(
        f"what was done for change {chg.number}",
        db=test_db
    )
    assert "CHG0007777" in resp_chg
    assert "Snapshot current dataset" in resp_chg
    assert "standby replica" in resp_chg
    assert "0 dropped packets" in resp_chg
    assert any(c["url"] == f"#/change-requests/{chg.number}" for c in cites_chg)

def test_ai_copilot_cross_project_similar_tickets_and_steps_taken(test_db):
    user = User(username="sre_eng", full_name="SRE Engineer", role="admin")
    test_db.add(user)
    test_db.flush()

    inc = Incident(
        number="INC0005555",
        caller_id=user.id,
        application_id=1,
        project_id=1,
        short_description="Memory leak on ingestion workers",
        description="Workers getting OOMKilled every 4 hours.",
        priority="P1",
        assignment_group_id=1,
        assigned_to_id=user.id,
        status="Resolved",
        close_category="Bug",
        resolution_notes="Patched unclosed file descriptor in streaming parser and increased heap limit to 2GB."
    )
    test_db.add(inc)
    test_db.flush()

    note = TicketWorkNote(
        ticket_type="incident",
        ticket_id=inc.id,
        user_id=user.id,
        note="Identified unclosed gzip streams. Applied hotfix commit #8839."
    )
    test_db.add(note)
    test_db.flush()

    resp, cites = EnterpriseKnowledgeFallback.generate_response(
        "give similar tickets and steps taken across projects",
        db=test_db
    )
    assert "Similar Resolved Tickets & Steps Taken" in resp
    assert "INC0005555" in resp
    assert "unclosed gzip streams" in resp or "unclosed file descriptor" in resp
    assert len(cites) > 0

def test_ai_copilot_generic_questions_knowledge():
    resp_micro, cites_micro = EnterpriseKnowledgeFallback.generate_response(
        "What is microservices architecture?"
    )
    assert "Microservices" in resp_micro
    assert "Decentralized Data Management" in resp_micro
    assert "API Gateways" in resp_micro
    assert "kubectl" not in resp_micro

    resp_oauth, cites_oauth = EnterpriseKnowledgeFallback.generate_response(
        "Explain OAuth 2.0 authorization framework"
    )
    assert "OAuth 2.0" in resp_oauth
    assert "Authorization Code Flow" in resp_oauth
    assert "Access Token" in resp_oauth
    assert "kubectl" not in resp_oauth

def test_km_short_token_and_chatcompletion_flow(test_db):
    import asyncio
    import json
    from unittest.mock import patch
    import httpx
    from backend.models import AIConfiguration
    from backend.ai_copilot import InternalChatCompletionProvider

    provider = InternalChatCompletionProvider()
    cfg = AIConfiguration(
        km_base_url="https://km.enterprise.corp",
        api_endpoint="/api/v2/acnopenai/chatcompletion",
        username="km_admin",
        password="secret_password",
        km_index="custom-kb-index",
        headers_template='{"Content-Type": "application/json", "apiToken": "{{apiToken}}"}',
        payload_template='''{
  "prompt": "{{prompt}}",
  "index": "{{index}}",
  "sessionid": "{{sessionid}}",
  "prompt_objective": "{{prompt_objective}}",
  "config": {},
  "reset_context": false,
  "prompt_prefix": "{{prompt_prefix}}"
}'''
    )

    captured_requests = []

    async def mock_request(*args, **kwargs):
        if len(args) > 1 and str(args[0]).upper() in ("GET", "POST", "PUT", "DELETE", "PATCH"):
            method = kwargs.get("method") or args[0]
            url = kwargs.get("url") or args[1]
        elif len(args) > 0:
            url = kwargs.get("url") or args[0]
            method = kwargs.get("method") or "POST"
        else:
            url = kwargs.get("url") or ""
            method = kwargs.get("method") or "POST"
        headers = kwargs.get("headers", {})
        content = kwargs.get("content")
        json_body = kwargs.get("json")
        captured_requests.append({
            "method": method,
            "url": str(url),
            "headers": headers,
            "content": content,
            "json": json_body
        })

        req = httpx.Request(method=str(method or "POST"), url=str(url))
        if "identity-management/api/v1/auth/token" in str(url):
            return httpx.Response(200, json={"token": "mock-short-lived-km-token-xyz"}, request=req)
        elif "acnopenai/chatcompletion" in str(url):
            return httpx.Response(200, json={"response": "Resolved by KM ChatCompletion."}, request=req)
        return httpx.Response(404, request=req)

    async def run_test():
        with patch.object(httpx.AsyncClient, "post", side_effect=mock_request), \
             patch.object(httpx.AsyncClient, "request", side_effect=mock_request):
            token = await provider._get_km_short_token(cfg)
            assert token == "mock-short-lived-km-token-xyz"
            assert "identity-management/api/v1/auth/token?useDeflate=true" in captured_requests[0]["url"]

            resp = await provider.chat(
                db=test_db,
                config=cfg,
                question="How to configure Kafka consumer group?",
                conversation_id="conv-session-123",
                ticket_context={"ticket_number": "INC0001234", "application": "Payment API"}
            )
            assert resp["content"] == "Resolved by KM ChatCompletion."

            chat_req = captured_requests[-1]
            assert "https://km.enterprise.corp/api/v2/acnopenai/chatcompletion" in chat_req["url"]
            assert chat_req["headers"].get("apiToken") == "mock-short-lived-km-token-xyz"

            body_dict = json.loads(chat_req["content"])
            assert "prompt" in body_dict
            assert body_dict["prompt"] == "How to configure Kafka consumer group?"
            assert body_dict["index"] == "custom-kb-index"
            assert body_dict["sessionid"] == "conv-session-123"
            assert body_dict["prompt_objective"] == "itsm_support_troubleshooting"
            assert "config" in body_dict
            assert body_dict["reset_context"] is False
            assert "prompt_prefix" in body_dict
            assert "Payment API" in body_dict["prompt_prefix"]

    asyncio.run(run_test())
