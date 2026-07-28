# Data Model

---

## Storage Technology

**SQLite** (`AGENT_DATABASE_URL`, default `sqlite:///./data/agent.db`) via SQLAlchemy 2.0 — per the brief's explicit stack instruction — holds all metadata: users, sessions, auth events, dataset/profile/annotation records, query runs, and query attempts (the audit trail). WAL mode is enabled for concurrent read/write safety at Phase 1–3's scale.

Raw CSV data itself is **not** stored in SQLite. Each upload is converted once to a **Parquet** file on local disk under `AGENT_DATASET_STORE_DIR` (default `./data/datasets/<dataset_id>.parquet`) and queried through DuckDB/pandas — see `spec/architecture.md` → Stack. `Dataset.storage_path` is the only pointer SQLite holds into that file; it is opaque to everything except `LocalParquetDataSource`, which is exactly the seam that lets a future `MySQLDataSource` replace it (see `spec/architecture.md` → "Keeping the Data-Source Layer Swappable").

## Entities

### Entity: User
*Introduced: Phase 1*

Represents one officer/analyst who can log in.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key |
| username | text, unique | yes | Login identifier |
| password_hash | text | yes | bcrypt hash — never plaintext |
| full_name | text | yes | Display name for audit attribution |
| role | text | yes | `"officer"` \| `"hq_analyst"` \| `"admin"` — informational in Phase 1 (no access-control differences yet) |
| station | text, nullable | no | Officer's station/unit, for audit context |
| is_active | boolean | yes | Deactivated accounts can't log in |
| created_at | timestamp | yes | |
| last_login_at | timestamp, nullable | no | |

> **Assumed:** no self-service registration in Phase 1. Accounts are provisioned via a seed/admin CLI script (`uv run python -m src.auth.seed_user <username> <full_name> <role>`), since the brief specifies local auth for attribution but not an account-creation flow. README documents at least one seeded test account.

### Entity: Session
*Introduced: Phase 1*

Server-side, revocable login session (not a stateless JWT — chosen for auditability/revocability in a government context).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key; also the session-cookie value (httpOnly, SameSite=Lax) |
| user_id | UUID (text), FK → User | yes | |
| created_at | timestamp | yes | |
| expires_at | timestamp | yes | `created_at + AGENT_SESSION_TTL_HOURS` (default 12h) |
| revoked_at | timestamp, nullable | no | Set on logout |

### Entity: AuthEvent
*Introduced: Phase 1*

Login/logout audit trail (part of the required audit trail, alongside `QueryRun`/`QueryAttempt`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key |
| user_id | UUID (text), FK → User, nullable | no | Null for a failed login against an unknown username |
| username_attempted | text | yes | Recorded even on failure |
| event_type | text | yes | `"login_success"` \| `"login_failure"` \| `"logout"` |
| created_at | timestamp | yes | |

### Entity: Dataset
*Introduced: Phase 1 (single-file); extended Phase 2 (grouping, derived lineage)*

One uploaded CSV, converted to Parquet, or (Phase 2) a derived/combined dataset.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key |
| name | text | yes | Display name (defaults to original filename) |
| original_filename | text | yes | |
| uploaded_by_user_id | UUID (text), FK → User | yes | Attribution |
| status | text | yes | `"processing"` \| `"ready"` \| `"failed"` |
| source_type | text | yes | `"upload"` (Phase 1) \| `"combined"` (Phase 2) \| `"derived"` (Phase 2) |
| storage_path | text | yes | Path to the Parquet file |
| row_count | integer, nullable | no | Set once profiled |
| size_bytes | integer | yes | |
| derived_from_query_run_id | UUID (text), FK → QueryRun, nullable | no | *Phase 2* — set when `source_type="derived"` |
| created_at | timestamp | yes | |
| updated_at | timestamp | yes | |

### Entity: DatasetProfile
*Introduced: Phase 1*

One per `Dataset` (1:1) — the auto-generated profile shown right after upload.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| dataset_id | UUID (text), FK → Dataset, PK | yes | |
| columns_json | JSON (text) | yes | `[{name, dtype, null_count, distinct_count, min, max}]` |
| row_count | integer | yes | |
| date_range_start | timestamp, nullable | no | Detected from the first plausible date column |
| date_range_end | timestamp, nullable | no | |
| quality_issues_json | JSON (text) | yes | `[{issue_type, column, affected_row_count, examples: [...]}]` — e.g. unparseable dates, missing values, type mismatches within a column |
| generated_at | timestamp | yes | |

### Entity: DatasetGroup / DatasetGroupMember
*Introduced: Phase 2*

Ties multiple same-schema `Dataset` uploads (e.g. monthly exports) into one logical, jointly-queryable dataset.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id (DatasetGroup) | UUID (text) | yes | Primary key |
| name | text | yes | |
| created_by_user_id | UUID (text), FK → User | yes | |
| created_at | timestamp | yes | |
| dataset_id (DatasetGroupMember) | UUID (text), FK → Dataset | yes | Composite key with `group_id` |
| group_id (DatasetGroupMember) | UUID (text), FK → DatasetGroup | yes | |

### Entity: DatasetAnnotation
*Introduced: Phase 2*

Persisted business-rule context per column (e.g. "IPC_Section = offence code") that improves future answers on that dataset.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key |
| dataset_id | UUID (text), FK → Dataset | yes | |
| column_name | text | yes | |
| note | text | yes | |
| created_by_user_id | UUID (text), FK → User | yes | |
| created_at | timestamp | yes | |
| updated_at | timestamp | yes | |

### Entity: QueryRun
*Introduced: Phase 1*

One natural-language question asked against a dataset — the primary audit unit for Q&A.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key (`query_run_id`) |
| dataset_id | UUID (text), FK → Dataset | yes | *Phase 2 extends addressing to a `DatasetGroup` via a nullable `dataset_group_id`* |
| user_id | UUID (text), FK → User | yes | Attribution |
| question | text | yes | |
| status | text | yes | `"pending"` \| `"needs_clarification"` \| `"completed"` \| `"failed"` |
| current_node | text, nullable | no | Written after every graph step, for progress polling |
| complexity | text, nullable | no | `"simple"` \| `"complex"` |
| plan_json | JSON (text), nullable | no | The step list from `plan_analysis`, if any |
| clarifying_question | text, nullable | no | Set when `status="needs_clarification"` |
| final_answer | text, nullable | no | |
| key_numbers_json | JSON (text), nullable | no | |
| assumptions_json | JSON (text), nullable | no | Flagged assumptions, if any |
| followups_json | JSON (text), nullable | no | `[]` in Phase 1 |
| error_message | text, nullable | no | |
| prompt_tokens | integer | yes | Sum across all LLM calls in this run |
| completion_tokens | integer | yes | |
| estimated_cost_usd | numeric | yes | |
| started_at | timestamp | yes | |
| completed_at | timestamp, nullable | no | |

### Entity: QueryAttempt
*Introduced: Phase 1*

One code-generation-and-execution attempt within a `QueryRun` (there can be more than one, per the internal retry loop) — this is what powers the "show the code that ran, including failed attempts" expand view and the audit detail.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (text) | yes | Primary key |
| query_run_id | UUID (text), FK → QueryRun | yes | |
| attempt_number | integer | yes | 1-indexed |
| generated_code | text | yes | The exact code that was validated/executed |
| execution_stdout | text, nullable | no | |
| execution_result_json | JSON (text), nullable | no | Capped to ≤50 rows if tabular, with `truncated` flag |
| execution_error | text, nullable | no | |
| duration_ms | integer | yes | |
| created_at | timestamp | yes | |

### Relationships

```
User 1───* Session
User 1───* AuthEvent
User 1───* Dataset (uploaded_by)
User 1───* QueryRun
Dataset 1───1 DatasetProfile
Dataset 1───* QueryRun
Dataset 1───* DatasetAnnotation                    (Phase 2)
DatasetGroup 1───* DatasetGroupMember───* Dataset  (Phase 2)
Dataset 0/1──1 QueryRun (derived_from_query_run_id) (Phase 2)
QueryRun 1───* QueryAttempt
```

**Conversation history** is not a separate entity — it is derived by loading the most recent `QueryRun` rows for a given `(user_id, dataset_id)` pair, ordered by `started_at`, per `spec/agent.md` → Memory & Context. This keeps the fact "what was asked and answered before" in exactly one place (`QueryRun`), avoiding duplicate storage.

## Data Lifecycle

- **Datasets persist indefinitely** once uploaded — no auto-expiry in Phase 1–3, per the brief ("datasets persist and stay available across sessions... potentially across multiple days").
- **QueryRun / QueryAttempt records are append-only** and permanent — they are the audit trail and are never deleted or edited by the application (no update/delete endpoints are exposed for them).
- **Sessions** expire after `AGENT_SESSION_TTL_HOURS` (default 12h) or on explicit logout (`revoked_at` set); expired/revoked sessions fail auth but the row itself is retained for audit purposes.
- **Derived datasets** (Phase 2) are created explicitly via "save as new dataset" and thereafter behave exactly like an uploaded dataset (independently profiled, queryable, and — because it too is a `Dataset` row — itself save-as-able).

## Sensitive Data

- **`password_hash`** — bcrypt, never logged, never returned by any API response.
- **Uploaded CSV contents / Parquet files** — case-related crime/FIR data. Restricted to authenticated users only in Phase 1 (no anonymous access to any dataset or query endpoint); no per-user/role isolation yet (explicit brief scope), so any logged-in officer can read any dataset. Flagged as a future hardening item (`spec/roadmap.md` → Future Direction) once the organization needs it.
- **`QueryRun.question` / `final_answer` / `QueryAttempt.generated_code`** — may reference real case details (e.g. specific offence types, locations) even though full raw rows are never sent to the LLM; these audit fields are themselves sensitive government data and are only exposed via authenticated `GET /audit*` endpoints, never publicly.
- **Session cookies** — httpOnly, SameSite=Lax, so they are inaccessible to client-side JS and not sent cross-site.
