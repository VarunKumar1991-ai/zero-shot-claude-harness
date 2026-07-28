# API

---

## API Style

REST, JSON over HTTPS-in-prod/HTTP-in-dev, served by Express at `http://localhost:8001/api/*`. Every response uses the envelope `{ data, error }` (`data: null` on error, `error: null` on success). Auth via httpOnly JWT session cookie.

## Endpoints / Commands

### `POST /api/auth/login`

**Purpose:** Authenticate an officer and start a session.

**Request:**
```json
{ "username": "string", "password": "string" }
```

**Response:**
```json
{ "data": { "id": "uuid", "username": "string", "displayName": "string" }, "error": null }
```
Sets an httpOnly `session` cookie (JWT, 12h expiry).

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | Missing username or password |
| 401 | Incorrect username or password |
| 500 | Internal/DB error |

---

### `POST /api/auth/logout`

**Purpose:** End the current session.

**Request:** none (session cookie only)

**Response:**
```json
{ "data": { "loggedOut": true }, "error": null }
```

---

### `GET /api/auth/me`

**Purpose:** Return the current logged-in officer.

**Response:**
```json
{ "data": { "id": "uuid", "username": "string", "displayName": "string" }, "error": null }
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 401 | No valid session |

---

### `POST /api/datasets`

**Purpose:** Upload a CSV and create a new dataset (or, in Phase 1, respond with a quality-flag summary requiring confirmation before final persistence if bad rows are detected).

**Request:** `multipart/form-data` — `file` (CSV, ≤100MB), `name` (optional string), `excludeBadRows` (optional boolean, default `false` — set `true` on a re-submit to confirm exclusion after reviewing flags).

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "rowCount": 12345,
    "columns": [{ "name": "offence_type", "inferredType": "string" }],
    "dateRangeMin": "2026-01-01",
    "dateRangeMax": "2026-06-30",
    "qualityFlags": [{ "type": "unparseable_date", "count": 12, "sampleRowRefs": [45, 102] }]
  },
  "error": null
}
```

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | No file attached, wrong content type, empty CSV |
| 401 | Not logged in |
| 413 | File exceeds 100MB |
| 422 | Malformed CSV structure unrecoverable by the parser |
| 500 | Internal/DB/disk error |

---

### `GET /api/datasets`

**Purpose:** List all datasets visible to any logged-in officer (no per-user isolation in Phase 1/2).

**Response:**
```json
{ "data": [{ "id": "uuid", "name": "string", "rowCount": 12345, "createdAt": "iso8601" }], "error": null }
```

---

### `GET /api/datasets/:id/profile`

**Purpose:** Return the full auto-generated profile for a dataset.

**Response:** same shape as the `POST /api/datasets` success `data` field.

**Error cases:**
| Status | Condition |
|--------|-----------|
| 401 | Not logged in |
| 404 | Dataset not found |

---

### `POST /api/datasets/:id/queries`

**Purpose:** Ask a natural-language question against a dataset; runs the LangGraph.js agent end-to-end and returns the answer.

**Request:**
```json
{ "question": "How many thefts were reported in June?", "sessionId": "string" }
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "status": "completed",
    "answer": "There were 214 thefts reported in June.",
    "keyNumbers": [{ "label": "Thefts in June", "value": 214 }],
    "assumptions": [],
    "clarifyingQuestion": null,
    "generatedCode": "const juneThefts = rows.filter(...)...",
    "attempts": [{ "code": "...", "executionResult": { "result": 214, "error": null }, "inspection": "ok" }],
    "chartSpec": null,
    "followups": [],
    "tokenUsage": { "promptTokens": 812, "completionTokens": 143 },
    "createdAt": "iso8601",
    "completedAt": "iso8601"
  },
  "error": null
}
```

On `status: "needs_clarification"`, `answer` is `null` and `clarifyingQuestion` is populated instead.

**Error cases:**
| Status | Condition |
|--------|-----------|
| 400 | Missing/empty question |
| 401 | Not logged in |
| 404 | Dataset not found |
| 502 | LLM provider unavailable after retries (`status: "failed"` body still returned with a plain-language message, not a bare 502 with no body) |

---

### `GET /api/datasets/:id/queries`

**Purpose:** Return the query/audit history for a dataset, most recent first.

**Response:**
```json
{ "data": [{ "id": "uuid", "question": "string", "answer": "string", "status": "completed", "createdAt": "iso8601" }], "error": null }
```

---

## Phase 2 endpoints (contract reserved now, implemented in Phase 2)

- `POST /api/datasets/:id/combine` — combine same-schema files into one logical dataset
- `POST /api/datasets/:id/annotations`, `GET /api/datasets/:id/annotations`
- `GET /api/datasets/:id/queries/:qid/export` — download findings (CSV/PDF)
- `POST /api/datasets/:id/queries/:qid/save-as-dataset` — save a derived/cleaned result as a new dataset

## Authentication

httpOnly JWT session cookie set by `POST /api/auth/login`, verified by Express middleware on every route except `/api/auth/login`. No API-key/service-to-service auth in Phase 1/2 (no external integrations). CSRF mitigation: `SameSite=Strict` cookie attribute (single-origin frontend/backend per `architecture.md`, so no cross-site requests are expected).
