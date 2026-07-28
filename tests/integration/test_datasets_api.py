"""Dataset upload/profiling API contract tests — real FastAPI TestClient,
isolated SQLite DB, isolated dataset store dir. No LLM key required (this
slice makes no LLM calls); auth is real (via /auth/login), not mocked."""
import csv
import io
import random

import pytest
from sqlalchemy.orm import Session

from auth.password import hash_password
from db.models import User


@pytest.fixture(autouse=True)
def _dataset_store_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_DATASET_STORE_DIR", str(tmp_path / "datasets"))
    yield


def _create_officer(engine, username="officer.upload", password="Correct-Horse-99") -> tuple[str, str]:
    with Session(engine) as db:
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name="Upload Officer",
            role="officer",
        )
        db.add(user)
        db.commit()
        return user.id, password


def _login(api_client, username: str, password: str):
    r = api_client.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    return r


def _sample_fir_csv(n_rows: int = 120) -> bytes:
    """A realistic-shaped FIR CSV with a few deliberately malformed rows."""
    offence_types = ["Theft", "Assault", "Robbery", "Burglary", "Fraud"]
    locations = ["Lucknow", "Kanpur", "Agra", "Varanasi", "Meerut"]

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["case_number", "offence_type", "date_reported", "location"])

    rng = random.Random(42)
    for i in range(1, n_rows + 1):
        case_number = f"FIR{i:04d}"
        offence = rng.choice(offence_types)
        month = rng.randint(1, 12)
        day = rng.randint(1, 28)
        date_str = f"2024-{month:02d}-{day:02d}"
        location = locations[rng.randrange(len(locations))]

        if i == 10:
            case_number = ""  # missing value
        if i == 20:
            date_str = "32/13/2024"  # unparseable date
        if i == 30:
            location = ""  # missing value

        writer.writerow([case_number, offence, date_str, location])

    return buffer.getvalue().encode("utf-8")


def test_upload_dataset_returns_profile_with_quality_issues(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db)
    _login(api_client, "officer.upload", password)

    csv_bytes = _sample_fir_csv(120)
    r = api_client.post(
        "/datasets/upload",
        files={"file": ("june_firs.csv", csv_bytes, "text/csv")},
        data={"name": "June FIRs"},
    )
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["status"] == "ready"
    assert body["name"] == "June FIRs"
    assert body["dataset_id"]

    profile = body["profile"]
    assert profile["row_count"] == 120
    column_names = {c["name"] for c in profile["columns"]}
    assert column_names == {"case_number", "offence_type", "date_reported", "location"}

    issue_types = {issue["issue_type"] for issue in profile["quality_issues"]}
    assert "missing_value" in issue_types
    assert "unparseable_date" in issue_types

    date_issue = next(i for i in profile["quality_issues"] if i["issue_type"] == "unparseable_date")
    assert date_issue["column"] == "date_reported"
    assert date_issue["affected_row_count"] == 1
    assert "32/13/2024" in date_issue["examples"]

    assert profile["date_range"]["start"] is not None
    assert profile["date_range"]["end"] is not None


def test_get_datasets_list_and_detail(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.list")
    _login(api_client, "officer.list", password)

    csv_bytes = _sample_fir_csv(50)
    upload_r = api_client.post(
        "/datasets/upload", files={"file": ("small.csv", csv_bytes, "text/csv")}
    )
    assert upload_r.status_code == 200
    dataset_id = upload_r.json()["data"]["dataset_id"]

    list_r = api_client.get("/datasets")
    assert list_r.status_code == 200
    items = list_r.json()["data"]
    listed_ids = {d["dataset_id"] for d in items}
    assert dataset_id in listed_ids
    listed = next(d for d in items if d["dataset_id"] == dataset_id)
    assert listed["row_count"] == 50
    assert listed["uploaded_by"] == "Upload Officer"
    assert listed["status"] == "ready"

    detail_r = api_client.get(f"/datasets/{dataset_id}")
    assert detail_r.status_code == 200
    detail = detail_r.json()["data"]
    assert detail["profile"]["row_count"] == 50
    assert detail["uploaded_by"] == "Upload Officer"
    assert detail["created_at"]
    assert detail["updated_at"]


def test_get_dataset_not_found_returns_404(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.notfound")
    _login(api_client, "officer.notfound", password)

    r = api_client.get("/datasets/does-not-exist")
    assert r.status_code == 404


def test_upload_empty_file_returns_400(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.empty")
    _login(api_client, "officer.empty", password)

    r = api_client.post("/datasets/upload", files={"file": ("empty.csv", b"", "text/csv")})
    assert r.status_code == 400


def test_upload_garbage_file_returns_400(api_client, _isolated_db):
    _, password = _create_officer(_isolated_db, username="officer.garbage")
    _login(api_client, "officer.garbage", password)

    garbage = bytes(range(256)) * 4
    r = api_client.post(
        "/datasets/upload",
        files={"file": ("garbage.bin", garbage, "application/octet-stream")},
    )
    assert r.status_code == 400


def test_upload_oversized_file_returns_400(api_client, _isolated_db, monkeypatch):
    monkeypatch.setenv("AGENT_MAX_CSV_MB", "0")  # 0MB cap forces rejection
    _, password = _create_officer(_isolated_db, username="officer.oversized")
    _login(api_client, "officer.oversized", password)

    csv_bytes = _sample_fir_csv(5)
    r = api_client.post("/datasets/upload", files={"file": ("small.csv", csv_bytes, "text/csv")})
    assert r.status_code == 400


def test_upload_requires_auth(api_client):
    csv_bytes = _sample_fir_csv(5)
    r = api_client.post("/datasets/upload", files={"file": ("small.csv", csv_bytes, "text/csv")})
    assert r.status_code == 401


def test_list_datasets_requires_auth(api_client):
    r = api_client.get("/datasets")
    assert r.status_code == 401


def test_get_dataset_detail_requires_auth(api_client):
    r = api_client.get("/datasets/some-id")
    assert r.status_code == 401
