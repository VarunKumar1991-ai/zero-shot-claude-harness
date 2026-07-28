# API

---

## API Style

REST, served by FastAPI at `http://localhost:8001` (port per `harness/patterns/tech-stack.md`). Every response uses the existing envelope: `{"data": ..., "error": null}` on success (`ok()`), or a `4xx`/`5xx` with `{"detail": {"code": ..., "message": ...}}` (`api_error()`). Auth is a server-side session via an httpOnly cookie (`sid`) — no bearer tokens in Phase 1.

## Authentication

- `POST /auth/login` issues a `Session` row and sets the `sid` cookie (httpOnly, SameSite=Lax, expires per `AGENT_SESSION_TTL_HOURS`).
- Every endpoint below except `POST /auth/login` requires a valid, unexpired, unrevoked session — missing/invalid session → `401 UNAUTHENTICATED`.
- Phase 1 has no per-user data scoping: any authenticated user may read any dataset, query, or audit record (explicit brief scope — see `spec/roadmap.md` → Out of Scope).

## Endpoints

### `POST /auth/login`

**Purpose:** authenticate an officer/analyst and start a session.

**Request:**
```json
{ "username": "string", "password": "string" }
```

**Response:**
```json
{ "data": { "user_id": "uuid", "username": "string", "full_name": "string", "role": "officer|hq_analyst|admin" }, "error": null }
```
Sets `Set-Cookie: sid=<session_id>; HttpOnly; SameSite=Lax; Max-Age=43200`.

**Error cases:**
| Status | Condition |
|--------|-----------|
| 401 | invalid username or password (generic message — never reveals which was wrong); an `AuthEvent(event_type="login_failure")` is still recorded |
| 400 | missing/empty `username` or `password` |

---

### `POST /auth/logout`

**Purpose:** revoke the current session.

**Request:** none (session cookie only)

**Response:**
```json
{ "data": { "ok": true }, "error": null }
```
Clears the `sid` cookie; records `AuthEvent(event_type="logout")`.

---

### `GET /auth/me`

**Purpose:** confirm the current session and return the logged-in user, for the frontend's route guard.

**Response:**
```json
{ "data": { "user_id": "uuid", "username": "string", "full_name": "string", "role": "string" }, "error": null }
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 401 | no/expired/revoked session |

---

### `POST /datasets/upload`

**Purpose:** upload one CSV, ingest it (CSV → Parquet), and return its auto-generated profile.

**Request:** `multipart/form-data`, field `file` (CSV, ≤ `AGENT_MAX_CSV_MB` default 100MB), optional field `name` (display name override).

**Response:**
```json
{
  "data": {
    "dataset_id": "uuid",
    "name": "string",
    "status": "ready",
    "profile": {
      "row_count": 12345,
      "columns": [
        { "name": "offence_type", "dtype": "string", "null_count": 0, "distinct_count": 14, "sample_values": ["Theft", "Assault", "..."] },
        { "name": "date_reported", "dtype": "date", "null_count": 3, "min": "2024-01-01", "max": "2024-12-31" }
      ],
      "date_range": { "start": "2024-01-01", "end": "2024-12-31" },
      "quality_issues": [
        { "issue_type": "unparseable_date", "column": "date_reported", "affected_row_count": 5, "examples": ["32/13/2024"] },
        { "issue_type": "missing_value", "column": "case_number", "affected_row_count": 2, "examples": [] }
      ]
    }
  },
  "error": null
}
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | file too large (`>AGENT_MAX_CSV_MB`), empty file, not a parseable CSV (no columns detected) |
| 401 | not authenticated |
| 500 | ingestion failure (disk write error) — never leaves a partially-written `Dataset` row marked `ready` |

---

### `GET /datasets`

**Purpose:** list all datasets visible to the logged-in user (all datasets, in Phase 1).

**Response:**
```json
{ "data": [ { "dataset_id": "uuid", "name": "string", "row_count": 12345, "uploaded_by": "string", "status": "ready", "created_at": "iso8601" } ], "error": null }
```

---

### `GET /datasets/{dataset_id}`

**Purpose:** dataset detail + full profile.

**Response:** same shape as `POST /datasets/upload`'s `data`, plus `uploaded_by`, `created_at`, `updated_at`.

**Error cases:**
| Status | Condition |
|--------|-----------|
| 404 | dataset not found |

---

### `POST /datasets/{dataset_id}/query`

**Purpose:** ask a natural-language question against a dataset; starts the agent graph asynchronously.

**Request:**
```json
{ "question": "How many thefts were reported in June?" }
```

**Response (immediate — the graph runs in the background):**
```json
{ "data": { "query_run_id": "uuid", "status": "pending" }, "error": null }
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 404 | dataset not found |
| 400 | empty question |
| 401 | not authenticated |

---

### `GET /datasets/{dataset_id}/queries/{query_run_id}`

**Purpose:** poll for progress and the final result — the frontend polls this every ~1s while `status` is `"pending"`.

**Response (in progress):**
```json
{ "data": { "query_run_id": "uuid", "status": "pending", "current_node": "generate_code" }, "error": null }
```

**Response (completed):**
```json
{
  "data": {
    "query_run_id": "uuid",
    "status": "completed",
    "question": "How many thefts were reported in June?",
    "final_answer": "There were 47 thefts reported in June 2024.",
    "key_numbers": { "count": 47 },
    "assumptions": [],
    "complexity": "simple",
    "plan": null,
    "attempts": [
      {
        "attempt_number": 1,
        "generated_code": "def analyze(df):\n    return {\"count\": int((df['offence_type'] == 'Theft').sum())}",
        "execution_result": { "count": 47 },
        "execution_error": null,
        "duration_ms": 340
      }
    ],
    "followups": [],
    "prompt_tokens": 1820,
    "completion_tokens": 340,
    "estimated_cost_usd": 0.0041,
    "started_at": "iso8601",
    "completed_at": "iso8601"
  },
  "error": null
}
```

**Response (needs clarification):**
```json
{ "data": { "query_run_id": "uuid", "status": "needs_clarification", "clarifying_question": "Do you mean FIR cases or convictions?" }, "error": null }
```

**Response (failed):**
```json
{ "data": { "query_run_id": "uuid", "status": "failed", "error": "The analysis service is temporarily unavailable — please try again." }, "error": null }
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 404 | query_run_id not found (or belongs to a different dataset_id) |

---

### `GET /datasets/{dataset_id}/conversation`

**Purpose:** the last `AGENT_CONVERSATION_HISTORY_TURNS` question/answer pairs for the current user + dataset, to render as chat history on page load.

**Response:**
```json
{ "data": [ { "query_run_id": "uuid", "question": "string", "final_answer": "string|null", "status": "string", "started_at": "iso8601" } ], "error": null }
```

---

### `GET /audit`

**Purpose:** paginated, filterable audit log (all authenticated users can view, per Phase 1 scope).

**Request (query params):** `user_id?`, `dataset_id?`, `from?` (iso date), `to?` (iso date), `page?` (default 1), `page_size?` (default 50, max 200)

**Response:**
```json
{
  "data": {
    "items": [
      { "type": "login_success", "user": "string", "timestamp": "iso8601", "detail": "string" },
      { "type": "upload", "user": "string", "dataset": "string", "timestamp": "iso8601", "detail": "12,345 rows" },
      { "type": "query", "user": "string", "dataset": "string", "timestamp": "iso8601", "detail": "How many thefts...?", "status": "completed", "query_run_id": "uuid" }
    ],
    "page": 1, "page_size": 50, "total": 132
  },
  "error": null
}
```

---

### `GET /audit/{query_run_id}`

**Purpose:** full detail for one query run — every attempt's code, stdout, result, and error — for scrutiny.

**Response:** same shape as `GET /datasets/{dataset_id}/queries/{query_run_id}`'s completed response, plus `user` (full name + username) and `dataset` (name).

**Error cases:**
| Status | Condition |
|--------|-----------|
| 404 | query_run_id not found |
