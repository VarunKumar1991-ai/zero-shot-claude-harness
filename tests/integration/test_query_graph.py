"""End-to-end integration tests for the query agent graph.

Requires a real `AGENT_GEMINI_API_KEY` (or `AGENT_ANTHROPIC_API_KEY`) in
`.env` — the happy-path test makes a REAL LLM call end to end, never a stub
(per harness/rules/ai-agents.md). `pytest.skip`s if no key is present.
"""
import csv
import io

import pytest
from sqlalchemy.orm import Session

from auth.password import hash_password
from db.models import Dataset, QueryAttempt, QueryRun, User
from graph.edges import after_inspect_result
from graph.nodes import inspect_result


@pytest.fixture(autouse=True)
def _dataset_store_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_DATASET_STORE_DIR", str(tmp_path / "datasets"))
    yield


def _create_officer(engine, username="officer.query", password="Correct-Horse-42") -> tuple[str, str]:
    with Session(engine) as db:
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name="Query Officer",
            role="officer",
        )
        db.add(user)
        db.commit()
        return user.id, password


def _login(api_client, username: str, password: str):
    r = api_client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    return r


# 20 rows, exactly 6 with offence_type == "Theft" — the hand-countable known answer.
_THEFT_ROWS = [
    ("FIR0001", "Theft", "2024-06-01", "Lucknow"),
    ("FIR0002", "Assault", "2024-06-02", "Kanpur"),
    ("FIR0003", "Theft", "2024-06-03", "Lucknow"),
    ("FIR0004", "Burglary", "2024-06-04", "Agra"),
    ("FIR0005", "Theft", "2024-06-05", "Varanasi"),
    ("FIR0006", "Robbery", "2024-06-06", "Meerut"),
    ("FIR0007", "Theft", "2024-06-07", "Lucknow"),
    ("FIR0008", "Assault", "2024-06-08", "Kanpur"),
    ("FIR0009", "Theft", "2024-06-09", "Agra"),
    ("FIR0010", "Fraud", "2024-06-10", "Varanasi"),
    ("FIR0011", "Burglary", "2024-06-11", "Meerut"),
    ("FIR0012", "Theft", "2024-06-12", "Lucknow"),
    ("FIR0013", "Assault", "2024-06-13", "Kanpur"),
    ("FIR0014", "Robbery", "2024-06-14", "Agra"),
    ("FIR0015", "Fraud", "2024-06-15", "Varanasi"),
    ("FIR0016", "Burglary", "2024-06-16", "Meerut"),
    ("FIR0017", "Assault", "2024-06-17", "Lucknow"),
    ("FIR0018", "Robbery", "2024-06-18", "Kanpur"),
    ("FIR0019", "Fraud", "2024-06-19", "Agra"),
    ("FIR0020", "Assault", "2024-06-20", "Varanasi"),
]
_KNOWN_THEFT_COUNT = sum(1 for row in _THEFT_ROWS if row[1] == "Theft")  # == 6


def _fir_csv_bytes() -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["case_number", "offence_type", "date_reported", "location"])
    writer.writerows(_THEFT_ROWS)
    return buffer.getvalue().encode("utf-8")


def _upload_dataset(api_client) -> str:
    r = api_client.post(
        "/datasets/upload",
        files={"file": ("june_firs.csv", _fir_csv_bytes(), "text/csv")},
        data={"name": "June FIRs"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["dataset_id"]


def test_create_query_rejects_empty_question(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.empty_q")
    _login(api_client, "officer.empty_q", password)
    dataset_id = _upload_dataset(api_client)

    r = api_client.post(f"/datasets/{dataset_id}/query", json={"question": "   "})
    assert r.status_code == 400


def test_create_query_dataset_not_found(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.no_dataset")
    _login(api_client, "officer.no_dataset", password)

    r = api_client.post("/datasets/does-not-exist/query", json={"question": "How many thefts?"})
    assert r.status_code == 404


def test_get_query_not_found(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.no_query")
    _login(api_client, "officer.no_query", password)
    dataset_id = _upload_dataset(api_client)

    r = api_client.get(f"/datasets/{dataset_id}/queries/does-not-exist")
    assert r.status_code == 404


def test_inspect_result_retries_then_gives_up_with_assumption():
    """Direct test of the reflection/retry-routing logic (spec/agent.md ->
    `inspect_result`), without invoking the full LLM loop."""
    state = {
        "execution_result": None,
        "execution_error": "KeyError: 'offence_type'",
        "retry_count": 0,
        "max_retries": 2,
        "assumptions": [],
    }

    state = inspect_result(state)
    assert after_inspect_result(state) == "generate_code"
    assert state["retry_count"] == 1

    state["execution_error"] = "KeyError: 'offence_type'"
    state = inspect_result(state)
    assert after_inspect_result(state) == "generate_code"
    assert state["retry_count"] == 2

    state["execution_error"] = "KeyError: 'offence_type'"
    state = inspect_result(state)
    assert after_inspect_result(state) == "synthesize_answer"
    assert state["retry_count"] == 2  # retries exhausted, no further increment
    assert state["assumptions"], "must flag an assumption when proceeding on a failed result"


def test_inspect_result_proceeds_immediately_on_good_result():
    state = {
        "execution_result": {"count": 6},
        "execution_error": None,
        "retry_count": 0,
        "max_retries": 3,
        "assumptions": [],
    }
    state = inspect_result(state)
    assert after_inspect_result(state) == "synthesize_answer"
    assert state["assumptions"] == []


@pytest.mark.usefixtures("_require_llm_key")
def test_query_end_to_end_answers_correctly(api_client, _isolated_db):
    """Real end-to-end: real Gemini calls, real sandboxed pandas execution,
    real SQLite audit persistence. The fixture has a hand-countable answer:
    exactly 6 of 20 rows have offence_type == 'Theft'."""
    _, password = _create_officer(_isolated_db)
    _login(api_client, "officer.query", password)
    dataset_id = _upload_dataset(api_client)

    create_r = api_client.post(
        f"/datasets/{dataset_id}/query",
        json={"question": "How many rows have offence_type Theft?"},
    )
    assert create_r.status_code == 200, create_r.text
    query_run_id = create_r.json()["data"]["query_run_id"]
    assert create_r.json()["data"]["status"] == "pending"

    # The TestClient runs BackgroundTasks synchronously as part of the request
    # cycle, so the graph has already finished by the time we poll — but poll
    # anyway to exercise the real progress-poll contract.
    poll_r = api_client.get(f"/datasets/{dataset_id}/queries/{query_run_id}")
    assert poll_r.status_code == 200
    body = poll_r.json()["data"]

    assert body["status"] in ("completed", "needs_clarification"), body
    if body["status"] == "needs_clarification":
        pytest.skip(f"Agent asked a clarifying question instead of answering: {body.get('clarifying_question')}")

    assert body["status"] == "completed", body
    assert body["final_answer"]
    assert str(_KNOWN_THEFT_COUNT) in body["final_answer"] or (
        body["key_numbers"] and _KNOWN_THEFT_COUNT in body["key_numbers"].values()
    ), f"expected the known count {_KNOWN_THEFT_COUNT} to appear in the answer: {body}"

    assert body["attempts"], "at least one code-generation attempt must be recorded"
    first_attempt_code = body["attempts"][0]["generated_code"]
    assert "def analyze(" in first_attempt_code
    assert "placeholder" not in first_attempt_code.lower()

    # --- Audit persistence: QueryRun + QueryAttempt actually land in SQLite ---
    with Session(_isolated_db) as db:
        run = db.get(QueryRun, query_run_id)
        assert run is not None
        assert run.status == "completed"
        assert run.final_answer
        assert run.prompt_tokens > 0
        assert run.completion_tokens > 0

        attempts = db.query(QueryAttempt).filter(QueryAttempt.query_run_id == query_run_id).all()
        assert len(attempts) >= 1
        assert attempts[0].generated_code == first_attempt_code
