# Architecture

---

## System Overview

A single FastAPI service (extending this repo's skeleton) serves a REST API and a statically-exported Next.js UI at `/app/`. Officers authenticate with a local username/password, upload CSV crime/FIR records which are ingested into a local columnar store, and ask natural-language questions that are answered by a LangGraph agent: the agent inspects the dataset's schema (never raw rows, beyond a small redacted sample), writes pandas analysis code with Gemini, executes that code in a sandboxed subprocess against the real uploaded data, inspects and retries on failure, and synthesizes a plain-language answer. Every login, upload, and query (including every retried code attempt) is written to a SQLite audit store. The data-access layer is abstracted behind a `DataSource` protocol so a future MySQL-backed implementation can replace the local CSV/Parquet one without touching the agent graph or sandbox.

## Component Map

```
Next.js UI (/app/)
    │  fetch (cookie-authenticated)
    ▼
FastAPI (src/api/*)
    │
    ├── auth.py ──────────► src/auth/ (password hashing, session store) ──► SQLite (users, sessions, auth_events)
    │
    ├── datasets.py ──────► src/ingestion/ (CSV validate → Parquet + profile)
    │                            │
    │                            ▼
    │                       src/data_sources/ (DataSource protocol)
    │                            │
    │                            ├─ LocalParquetDataSource  (Phase 1–3, DuckDB over local Parquet files)
    │                            └─ [future] MySQLDataSource (read replica; not built now)
    │                            │
    │                       SQLite (datasets, dataset_profiles) + local Parquet files on disk
    │
    └── query.py ─────────► src/graph/ (LangGraph agent)
                                 │
                                 ├── load_context ──► DataSource (schema/profile/sample/annotations)
                                 ├── classify_and_assess ──► Gemini (fast model)
                                 ├── plan_analysis ──► Gemini (quality model)
                                 ├── generate_code ──► Gemini (quality model)
                                 ├── execute_code ──► src/sandbox/executor.py ──► DataSource.get_dataframe()
                                 ├── inspect_result (deterministic + optional Gemini check)
                                 ├── synthesize_answer ──► Gemini (quality model)
                                 └── finalize ──► SQLite (query_runs, query_attempts)  ← audit trail
```

## Layers

| Layer | Responsibility |
|-------|----------------|
| API (`src/api/`) | HTTP surface, request/response envelopes, session-cookie auth guard, no business logic |
| Auth (`src/auth/`) | Password hashing/verification, server-side session issuance/validation, `get_current_user` dependency |
| Ingestion (`src/ingestion/`) | CSV validation, quality-issue detection, CSV→Parquet conversion |
| Data source (`src/data_sources/`) | The single abstraction the agent/sandbox use to read data — swappable backend |
| Agent (`src/graph/`) | LangGraph state, nodes, edges, graph assembly, conversation-history loading |
| Sandbox (`src/sandbox/`) | AST-validated, timeboxed, isolated execution of LLM-generated pandas code |
| LLM (`src/llm/`) | Provider-agnostic client (already wired for Anthropic/Gemini auto-detect) |
| Persistence (`src/db/`) | SQLAlchemy models + session management (SQLite) |
| Observability (`src/observability/`) | Structured logging of every LLM call and node transition |

## Data Flow

1. **Trigger:** an authenticated officer submits a question against a dataset via `POST /datasets/{id}/query`.
2. `query.py` creates a `QueryRun` row (`status=pending`) and schedules the graph run as a FastAPI background task; the request returns immediately with `query_run_id`.
3. The graph runs via `agentic_ai.stream(...)`, updating `QueryRun.current_node`/`status` in the DB after every node so the UI can poll real progress.
4. `load_context` reads the dataset's profile, up to 5 redacted sample rows, any saved annotations, and the last N conversation turns for this (user, dataset) pair from the `DataSource` and SQLite — this is the only node that touches raw data directly, and it caps/redacts what it forwards.
5. `classify_and_assess` (Gemini fast model) decides simple-vs-complex and whether to ask a clarifying question.
6. For complex questions, `plan_analysis` (Gemini quality model) drafts a short step plan.
7. `generate_code` (Gemini quality model) writes a single `analyze(df)` pandas function using only the schema/sample/plan context — never the full dataset.
8. `execute_code` runs that function inside `src/sandbox/executor.py`: a separate, timeboxed, restricted subprocess with the real `DataFrame` loaded from the `DataSource`.
9. `inspect_result` sanity-checks the outcome; on failure it loops back to `generate_code` (bounded retries, different approach each time); once retries are exhausted it proceeds with the best available result, flagged.
10. `synthesize_answer` (Gemini quality model) turns the computed result into a plain-language answer + key numbers + any flagged assumptions — the LLM only ever sees the aggregated/computed result, never raw rows.
11. `finalize` persists the `QueryRun` and every `QueryAttempt` (code, stdout, error, duration) to SQLite — this **is** the audit trail — and marks the run `completed`/`failed`/`needs_clarification`.
12. **Output:** the UI polls `GET /datasets/{id}/queries/{query_id}` until `completed`, then renders the plain-language answer, key numbers, expandable code/attempts, and token/cost usage.

## External Dependencies

| Dependency | Purpose | Failure Mode |
|------------|---------|--------------|
| Gemini API (`AGENT_GEMINI_API_KEY`) | Classification, planning, code generation, answer synthesis | Provider call wrapped in retry-with-backoff (2 retries, exponential); on exhaustion the node sets `state["error"]` and the graph routes to `handle_error`, which still `finalize`s an audit record with `status=failed` and a human-readable error — never a raw stack trace to the user |
| Local filesystem (`AGENT_UPLOAD_DIR`, `AGENT_DATASET_STORE_DIR`) | Raw CSV staging + Parquet dataset store | Disk write failures surface as a 500 with a clear message at upload time; existing datasets are read-only for querying so an ingestion failure never corrupts an already-profiled dataset |
| SQLite (`AGENT_DATABASE_URL`) | Users, sessions, audit events, dataset/profile/annotation metadata, query runs & attempts | WAL mode enabled for concurrent-read safety under Phase 1's modest concurrency target; a DB error on a query surfaces as `status=failed` on that run, not a crash |

## Stack

- **Language:** Python 3.12+ (backend, matches the existing `src/` skeleton) and TypeScript (frontend, matches `frontend/`)
- **Agent framework:** LangGraph — see `spec/agent.md` for the full graph
- **LLM provider + model:** Google Gemini via `AGENT_GEMINI_API_KEY` (already auto-detected by `src/config/settings.py` / `src/llm/providers/factory.py` — no code change needed to select the provider). `gemini-3.1-pro` (existing default) for planning/code-generation/synthesis (quality-sensitive); `gemini-2.5-flash` for the fast classification/assessment node (latency-sensitive, cheap). Both are env-configurable.
- **Backend:** FastAPI (existing skeleton), extended with new routers
- **Database + ORM:** SQLite + SQLAlchemy 2.0 (existing skeleton) for all metadata, auth, and audit tables — matches the brief's explicit instruction. Raw CSV data is **not** stored in SQLite; it is converted once to Parquet on disk and queried through DuckDB (see below).
- **Analytical data store (uploaded CSVs):** Each uploaded CSV is parsed and converted once to a typed **Parquet** file under `AGENT_DATASET_STORE_DIR` (default `./data/datasets/`). Queries load the Parquet file as a pandas `DataFrame` via DuckDB (`duckdb.sql("SELECT * FROM read_parquet(?)").df()`), which is fast, typed, and handles the ~100MB target comfortably without a database server. This mechanism is entirely encapsulated behind the `DataSource` protocol (below) — swappable.
- **Frontend:** Next.js 15 + React 19 (existing skeleton, static export served by FastAPI at `/app/`)
- **Dependency management:** uv (Python) / pnpm (TypeScript)

| Key library | Version | Purpose |
|-------------|---------|---------|
| `pandas` | >=2.2 | DataFrame analysis, both inside and outside the sandbox |
| `pyarrow` | >=16 | Parquet read/write for the local analytical store |
| `duckdb` | >=1.0 | Fast, zero-server CSV→Parquet ingestion and Parquet querying |
| `bcrypt` | >=4.1 | Password hashing for local auth |
| `python-multipart` | >=0.0.9 | FastAPI file-upload (multipart CSV) support |
| `langgraph` | >=0.1 | Agent graph (already in `pyproject.toml`) |
| `google-genai` | >=2.9 | Gemini client (already in `pyproject.toml`) |
| `structlog` | >=24.1 | Structured logging (already in `pyproject.toml`) |

**Avoid:** no ORM/repository indirection beyond direct SQLAlchemy queries (per `harness/patterns/code.md`); no Celery/RQ/worker infrastructure in Phase 1–3 — a FastAPI `BackgroundTasks` call plus a DB-polled `current_node` field is sufficient at this concurrency scale and keeps deployment to a single process; no `exec`/`eval` of LLM-generated code outside `src/sandbox/executor.py`'s AST-validated, subprocess-isolated path.

> **Assumed:** `src/config/settings.py` is extended (never replaced) with the following new fields, all with the stated defaults and all overridable via `AGENT_*` env vars, since the brief leaves these operational knobs unspecified: `upload_dir` (`AGENT_UPLOAD_DIR`, default `./data/uploads`), `dataset_store_dir` (`AGENT_DATASET_STORE_DIR`, default `./data/datasets`), `max_csv_mb` (`AGENT_MAX_CSV_MB`, default `100`), `sandbox_timeout_seconds` (`AGENT_SANDBOX_TIMEOUT_SECONDS`, default `20`), `max_code_retries` (`AGENT_MAX_CODE_RETRIES`, default `3`), `conversation_history_turns` (`AGENT_CONVERSATION_HISTORY_TURNS`, default `5`), `session_ttl_hours` (`AGENT_SESSION_TTL_HOURS`, default `12`), `llm_fast_model` (`AGENT_LLM_FAST_MODEL`, default `gemini-2.5-flash`), and `data_source` (`AGENT_DATA_SOURCE`, default `local_parquet`). `.env.example` is updated to document each with its default.

## Sandboxing Approach for LLM-Generated Code Execution

`src/sandbox/executor.py` runs every LLM-generated `analyze(df)` (or, from Phase 2, `analyze(datasets)`) function in an isolated **subprocess** (`multiprocessing.get_context("spawn")`, portable across the Windows dev environment and Linux deployment):

1. **Static validation (before execution):** parse the code with `ast.parse`; reject it (never execute) if it contains: any `import`/`from` of a module outside the allowlist `{pandas, numpy, math, re, statistics, datetime}`; any name reference to `os`, `sys`, `subprocess`, `socket`, `pathlib`, `shutil`, `open`, `eval`, `exec`, `compile`, `__import__`; or any dunder attribute access (`__class__`, `__globals__`, etc.).
2. **Restricted namespace:** the child process execs the validated code with a minimal `__builtins__` allowlist (no `open`, `input`, `exit`) and the target `DataFrame` pre-bound as `df` (Phase 1) — the code never receives file paths, connection strings, or network access.
3. **Timeout + isolation:** the parent process joins the child with a hard timeout (`AGENT_SANDBOX_TIMEOUT_SECONDS`, default 20s); on timeout it terminates the child and records `execution_error="timed out after Ns"`. No shared memory or filesystem write access is granted to the child beyond returning its JSON-serializable result over a `multiprocessing.Queue`.
4. **Result capping:** any tabular result is capped to `head(50)` before being returned to the graph, with a `truncated: true` flag — this is also how the "never send raw rows to the LLM" guardrail is enforced on the way back into `synthesize_answer`.

## Keeping the Data-Source Layer Swappable for a Future MySQL Source

`src/data_sources/base.py` defines a `DataSource` protocol:

```python
class DataSource(Protocol):
    def profile(self, dataset_ref: str) -> DatasetProfile: ...
    def get_dataframe(self, dataset_ref: str, columns: list[str] | None = None) -> pd.DataFrame: ...
    def distinct_values(self, dataset_ref: str, column: str, limit: int = 20) -> list[str]: ...
    def row_count(self, dataset_ref: str) -> int: ...
```

- `LocalParquetDataSource` (Phase 1–3) implements this against local Parquet files via DuckDB.
- The agent graph (`load_context`, `execute_code`) and the sandbox executor depend **only** on this protocol — they never see file paths, SQL dialects, or connection details. `execute_code` receives a plain `pandas.DataFrame` regardless of where it came from.
- A future `MySQLDataSource` (not built in this roadmap) would implement the same four methods against a read replica, adding query pushdown/caching/row-limiting internally — the graph and sandbox code require **zero changes**. Selection is via one setting, `AGENT_DATA_SOURCE` (default `local_parquet`), resolved once in `src/data_sources/registry.py::get_data_source()`.
- This is why `get_dataframe` accepts an optional `columns` parameter even though `LocalParquetDataSource` currently just loads-then-selects: it lets a future MySQL implementation push column selection down to the query instead of pulling whole tables, without changing the call sites.

> **Assumed:** Phase 1's `get_dataframe` loads the full Parquet file into memory (bounded by the 100MB CSV cap, which is small for pandas). A future MySQL source would instead push filters/aggregation down via the same interface — that optimization is deferred with the MySQL phase itself, not built now.

## Deployment Model

Single long-running process (`uv run python -m src`), same as the existing skeleton: FastAPI serves both the API and the static-exported Next.js UI at `/app/` on port 8001. SQLite database and the Parquet dataset store live on local disk under `./data/`. No background workers or queues — code execution is subprocess-isolated per request, and query progress is tracked via DB polling from a FastAPI `BackgroundTasks` call. This is intentionally the smallest deployment that meets the Phase 1–3 concurrency target (per the brief: "don't over-engineer for [million-row/heavy-concurrency] scale now, but don't paint the architecture into a corner").
