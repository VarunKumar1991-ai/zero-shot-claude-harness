"""Auth + audit API contract tests — real FastAPI TestClient, isolated SQLite DB.
No LLM key required (this slice makes no LLM calls)."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from auth.password import hash_password
from db.models import AuthEvent, Dataset, QueryRun, User


def _create_officer(engine, username="officer.demo", password="Correct-Horse-99") -> tuple[str, str]:
    with Session(engine) as db:
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name="Demo Officer",
            role="officer",
        )
        db.add(user)
        db.commit()
        return user.id, password


def test_login_success_sets_cookie_and_records_event(api_client, _isolated_db):
    user_id, password = _create_officer(_isolated_db)

    r = api_client.post("/auth/login", json={"username": "officer.demo", "password": password})
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["username"] == "officer.demo"
    assert body["user_id"] == user_id
    assert "sid" in r.cookies

    with Session(_isolated_db) as db:
        events = db.query(AuthEvent).filter(AuthEvent.event_type == "login_success").all()
        assert len(events) == 1
        assert events[0].user_id == user_id


def test_login_failure_wrong_password_returns_401_and_records_event(api_client, _isolated_db):
    _create_officer(_isolated_db, username="officer.wrongpw")

    r = api_client.post(
        "/auth/login", json={"username": "officer.wrongpw", "password": "totally-wrong"}
    )
    assert r.status_code == 401
    assert "sid" not in r.cookies
    detail = r.json()["detail"]
    assert "invalid" in detail["message"].lower()

    with Session(_isolated_db) as db:
        failures = db.query(AuthEvent).filter(AuthEvent.event_type == "login_failure").all()
        assert len(failures) == 1
        assert failures[0].username_attempted == "officer.wrongpw"


def test_login_unknown_username_returns_401_generic_message(api_client, _isolated_db):
    r = api_client.post("/auth/login", json={"username": "nobody", "password": "whatever"})
    assert r.status_code == 401
    detail = r.json()["detail"]
    assert "invalid" in detail["message"].lower()
    assert "nobody" not in detail["message"]  # never reveal which field was wrong


def test_login_missing_fields_returns_400(api_client):
    r = api_client.post("/auth/login", json={"username": "", "password": ""})
    assert r.status_code == 400


def test_me_requires_cookie(api_client, _isolated_db):
    _create_officer(_isolated_db)

    r = api_client.get("/auth/me")
    assert r.status_code == 401


def test_me_returns_current_user_with_valid_cookie(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.me")
    login_resp = api_client.post(
        "/auth/login", json={"username": "officer.me", "password": password}
    )
    assert login_resp.status_code == 200

    r = api_client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["data"]["username"] == "officer.me"


def test_logout_revokes_session_and_records_event(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.logout")
    api_client.post("/auth/login", json={"username": "officer.logout", "password": password})

    r = api_client.post("/auth/logout")
    assert r.status_code == 200
    assert r.json()["data"]["ok"] is True

    # session cookie should now be invalid for /auth/me
    r2 = api_client.get("/auth/me")
    assert r2.status_code == 401

    with Session(_isolated_db) as db:
        logouts = db.query(AuthEvent).filter(AuthEvent.event_type == "logout").all()
        assert len(logouts) == 1


def test_audit_requires_auth(api_client):
    r = api_client.get("/audit")
    assert r.status_code == 401


def test_audit_returns_recorded_auth_events(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.audit")
    api_client.post("/auth/login", json={"username": "officer.audit", "password": password})

    r = api_client.get("/audit")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["total"] >= 1
    types = {item["type"] for item in body["items"]}
    assert "login_success" in types


def test_audit_pagination_params(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.page")
    api_client.post("/auth/login", json={"username": "officer.page", "password": password})

    r = api_client.get("/audit", params={"page": 1, "page_size": 1})
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["page"] == 1
    assert body["page_size"] == 1
    assert len(body["items"]) <= 1


def test_audit_includes_uploads_and_queries(api_client, _isolated_db):
    user_id, password = _create_officer(_isolated_db, username="officer.full")
    api_client.post("/auth/login", json={"username": "officer.full", "password": password})

    with Session(_isolated_db) as db:
        dataset = Dataset(
            name="june_firs.csv",
            original_filename="june_firs.csv",
            uploaded_by_user_id=user_id,
            status="ready",
            source_type="upload",
            storage_path="/tmp/june_firs.parquet",
            row_count=120,
            size_bytes=4096,
        )
        db.add(dataset)
        db.flush()
        query_run = QueryRun(
            dataset_id=dataset.id,
            user_id=user_id,
            question="How many thefts in June?",
            status="completed",
            final_answer="There were 12 thefts in June.",
            prompt_tokens=100,
            completion_tokens=20,
            estimated_cost_usd=0.001,
            started_at=datetime.now(timezone.utc),
        )
        db.add(query_run)
        db.commit()
        dataset_id = dataset.id
        query_run_id = query_run.id

    r = api_client.get("/audit")
    assert r.status_code == 200
    items = r.json()["data"]["items"]
    types = {item["type"] for item in items}
    assert "upload" in types
    assert "query" in types

    detail = api_client.get(f"/audit/{query_run_id}")
    assert detail.status_code == 200
    detail_data = detail.json()["data"]
    assert detail_data["question"] == "How many thefts in June?"
    assert detail_data["dataset"]["dataset_id"] == dataset_id
    assert detail_data["user"]["username"] == "officer.full"


def test_audit_detail_not_found_returns_404(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.404")
    api_client.post("/auth/login", json={"username": "officer.404", "password": password})

    r = api_client.get("/audit/does-not-exist")
    assert r.status_code == 404
