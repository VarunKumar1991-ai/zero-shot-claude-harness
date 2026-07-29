# Architecture

---

## System Overview

A Node.js + Express backend serves a REST API consumed by a Next.js/React frontend. Officers log in, upload CSV files of crime/FIR records, and ask natural-language questions. Each question is answered by a LangGraph.js agent that plans a strategy, has the LLM (Gemini) generate JavaScript analysis code, executes that code in a sandboxed worker thread against the real parsed CSV data, inspects the result, retries on failure, and synthesizes a plain-language answer. All uploads, profiles, queries, generated code, and results are persisted to SQLite for audit and cross-session/cross-day continuity.

## Component Map

```
[Next.js Frontend]  ──HTTP (REST, single-origin :8001/app)──►  [Express API]
                                                                     │
                                        ┌────────────────────────────┼─────────────────────────┐
                                        ▼                            ▼                          ▼
                                [Auth/Session]              [Dataset Service]           [Query/Audit Service]
                                (bcrypt + JWT)          (CSV parse, profile,                    │
                                        │                 store, combine)                       ▼
                                        │                            │                  [LangGraph.js Agent]
                                        │                            │                            │
                                        │                            │           ┌────────────────┼──────────────────┐
                                        │                            │           ▼                ▼                  ▼
                                        │                            │     [Gemini LLM Client]  [Sandbox Executor]  [SQLite via
                                        │                            │      (@google/          (worker_threads       Sequelize]
                                        │                            │       generative-ai)      + vm, resource-
                                        │                            │                            limited)
                                        ▼                            ▼                            │
                                 [SQLite: users,        [SQLite: datasets, dataset_files,  ────────┘
                                  sessions]              annotations, derived_datasets]
                                                                     │
                                                                     ▼
                                                          [Local Disk File Storage]
                                                          (uploaded CSV originals)
```

## Layers

| Layer | Responsibility |
|-------|----------------|
| **Frontend (Next.js)** | Login, dataset list/upload, profile display, Q&A chat panel, code/reasoning disclosure, Phase-1 stub surfaces |
| **API (Express routes)** | Auth, request validation, session enforcement, HTTP contract per `api.md`, response envelope |
| **Services** | CSV parsing/profiling, dataset combining, audit logging, annotation storage — pure business logic, no HTTP concerns |
| **Agent (LangGraph.js)** | Multi-step reasoning: plan → generate code → execute → inspect → retry → synthesize answer |
| **Sandbox Executor** | Runs LLM-generated JS in an isolated `worker_thread` with a restricted `vm` context, CPU/memory/time limits |
| **Data-source layer** | Abstract interface (`DataSource`) over "parsed CSV in memory/on disk" today; designed so a future MySQL-backed implementation can be swapped in without touching the agent or API layers |
| **Persistence (SQLite)** | Users, sessions, datasets, dataset files, annotations, queries (audit log), derived datasets |

## Data Flow

1. Trigger: officer logs in (session established), uploads one or more CSVs via the frontend.
2. `upload-profile-api` parses the CSV (streaming, via `csv-parse`), detects malformed rows, computes the profile (columns, types, row count, date range, quality flags), and persists the file + profile.
3. Officer asks a natural-language question in the Q&A panel.
4. `qa-api` invokes the LangGraph.js agent with `{ datasetId, question, conversationHistory }`.
5. The agent classifies the question, plans (for complex questions) or fast-paths (for simple counts/filters), asks Gemini to generate JS analysis code against a documented in-scope data shape (schema + small sample only — never the full raw rows in the prompt), executes that code in the sandboxed worker against the **full parsed dataset in the Node process**, inspects the numeric/tabular result, retries with a revised approach on execution error or low-confidence inspection (up to a bounded retry count), then asks Gemini to synthesize a plain-language answer from the **computed result** (not raw rows).
6. The audit service persists the query, generated code, result, retries, and timestamps.
7. Output: JSON answer (plain-language text, key numbers, optional table/chart spec, code trace, reasoning trace, suggested follow-ups, token/cost usage) rendered by the frontend; by default only the final answer is shown, with code/steps/reasoning behind an expand control.

## External Dependencies

| Dependency | Purpose | Failure Mode |
|------------|---------|--------------|
| Google Gemini API (`@google/generative-ai`) | Code generation + answer synthesis + classification/planning | Retried with backoff (up to 3 attempts); on exhausted retries the agent returns a clear "couldn't complete the analysis" error with the attempted steps visible, never a fabricated answer |
| SQLite (file-based, via Sequelize) | All persistence — users, datasets, queries, annotations | App fails fast at startup if the DB file/path is unwritable; mid-request DB errors are caught and surfaced as a 500 with a logged error, never a silent partial write |
| Local disk file storage | Stores original uploaded CSVs | Upload fails loudly with a clear error if disk write fails; no partial dataset is recorded |
| Node `worker_threads` sandbox | Executes LLM-generated analysis code | Worker timeout/crash is caught by the parent, treated as a failed code-execution attempt, and triggers the agent's retry path |

## Stack

> This project's concrete technology choices. The generic, every-project rules — model-naming, DB driver, dev port, test environment — live in `harness/patterns/tech-stack.md`; this section is only what **this** project picked. These choices are **binding constraints given by the user** (Node.js + Express, LangGraph.js, Next.js/React, SQLite Phase 1, Gemini) except where marked `> **Assumed:**`, which are the spec-writer's resolutions of unstated details.

- **Language:** TypeScript for the frontend (Next.js 15 + React 19, per repo convention for UI-heavy projects); JavaScript (Node.js 20 LTS, ESM) for the backend.
  > **Assumed:** backend stays plain JavaScript (not TypeScript) to match the existing `harness/patterns/project-layout.md` Node reference shape used elsewhere in this repo and to minimize build tooling; if the user wants full-stack TypeScript this is a low-cost later change since Express + LangGraph.js both support TS directly.
- **Agent framework:** LangGraph.js (`@langchain/langgraph`) — graph-based multi-step agent, described fully in `spec/agent.md`.
- **LLM provider + model:** Google Gemini via `@google/generative-ai`. Default model `gemini-3.1-pro` for planning/synthesis nodes (quality-sensitive), `gemini-2.5-flash` for the fast-path classify/simple-answer route (latency-sensitive). Both configurable via env var (`AGENT_LLM_MODEL_PRIMARY`, `AGENT_LLM_MODEL_FAST`). API key: `AGENT_GEMINI_API_KEY` (already present in `.env`).
- **Backend:** Node.js 20 LTS + Express.js 4.
- **Database + ORM/migration tool:** SQLite via **Sequelize** (ORM) + **sequelize-cli** (migrations). Chosen over `better-sqlite3` raw and Prisma because: (a) Sequelize's dialect abstraction (`sqlite` now, `mysql2` later) directly satisfies the brief's "swappable data-source-layer" requirement — the future MySQL phase changes only the Sequelize `dialect` config and connection string, not model code or queries; (b) `sequelize-cli` gives a real, versioned migration history (parallel to Alembic's role in the Python skeleton), which raw `better-sqlite3` has no equivalent for; (c) Prisma's schema-first migration model is heavier to retrofit onto a later hand-tuned MySQL read-replica/caching setup than Sequelize's query-builder model. Migrations live in `migrations/` at the repo root, run via `npx sequelize-cli db:migrate`.
  > **Assumed:** SQLite file lives at `data/agent.db` (gitignored), matching the Python skeleton's `AGENT_DATABASE_URL=sqlite:///./data/agent.db` convention, adapted to a Sequelize connection string `sqlite:./data/agent.db`.
- **CSV parsing:** `csv-parse` (streaming parser) — chosen over loading the whole file into a naive split/regex parser because it correctly handles quoted fields, embedded commas/newlines, and streams for the ~500MB target size without holding the raw text twice in memory.
- **In-process dataframe/analysis model:** parsed rows are held as a plain JS array of typed row objects (columns pre-typed by the profiler: string/number/date) in the Node process's memory for the duration of a query — **not** a full dataframe library. Rationale: `danfojs-node` (the closest analogue to pandas) is comparatively immature and adds a large dependency surface for operations (`filter`, `groupBy`, `reduce`, `Date` comparisons) that plain JS array methods already do well and that Gemini can reliably generate code against; DuckDB-node bindings were considered but rejected for Phase 1 because they'd require translating the sandbox's "safe subset" story into SQL generation instead of JS generation, adding complexity without a corresponding Phase-1 benefit. This is revisited if/when the MySQL phase needs push-down query generation.
  > **Assumed:** the LLM is prompted to write plain JS (`Array.prototype` methods: `filter`, `map`, `reduce`, `Set`, `Map`, basic date arithmetic) against a documented `rows: RowObject[]` variable, not any dataframe API — see `agent.md` for the exact sandbox contract.
- **Sandboxed code execution:** LLM-generated analysis code runs inside a dedicated **Node `worker_thread`**, inside that worker's own **`vm.Context`** (via `vm.createContext` + `vm.Script.runInContext`), with:
  - No `require`, no `process`, no `fs`, no network globals (`fetch`, `http`) exposed in the sandboxed context — only `rows` (the dataset), a small whitelisted helper object (`{ sum, mean, median, groupBy, parseDate }`), and standard built-ins (`Array`, `Math`, `Date`, `JSON`, `Set`, `Map`).
  - A hard execution timeout (5s default, configurable) enforced by `worker.terminate()` from the parent if the worker doesn't return in time.
  - A memory ceiling on the worker via Node's `resourceLimits` (`maxOldGenerationSizeMb`) passed to the `Worker` constructor, so a runaway allocation kills the worker instead of the process.
  - The worker communicates only via `postMessage`/structured-clone — the generated code cannot reach the parent process, the filesystem, or the network. This is the Node-appropriate equivalent of a locked-down code-execution tool and is treated as a critical security boundary since the agent executes LLM-generated code against real uploaded case data.
  - Rejected alternatives: plain `vm` in the main thread (no memory/CPU isolation — a runaway loop blocks the whole server); `vm2` (unmaintained, published CVEs, explicitly warned against by its own maintainers as of 2024+); shelling out to a subprocess per query (higher latency and OS-level complexity not justified at Phase-1 scale). `worker_threads` + `vm.Context` + `resourceLimits` + a hard timeout is the documented, actively-maintained, "no npm dependency to trust" option.
- **Frontend:** Next.js 15 + React 19 (TypeScript), Tailwind CSS v4, served as a static export mounted by Express at `/app` on the same origin (`:8001`) per `harness/patterns/tech-stack.md`'s single-origin rule.
- **Charting (Phase 2):** `recharts` — zoomable/filterable bar/line/pie, React-native API, no separate build step.
  > **Assumed:** chosen at architecture time even though wired in Phase 2, so the Phase-1 chart stub component can already import a real (but unused-on-the-path) `recharts` container without a later rewrite.
- **Dependency management:** npm workspaces — root `package.json` for the backend (`src/`), `frontend/package.json` for the Next.js app; both use `npm install` / `npm ci`. No pnpm/yarn — kept to the ecosystem default per Node conventions and to minimize tooling surface for this stack switch.
  > **Assumed:** the harness's general TypeScript default (`pnpm`) is overridden here in favor of plain `npm`, since the user's stack directive is Node.js + Express with no package-manager preference stated, and `npm` is the zero-extra-install default on any Node 20 install — chosen to minimize setup friction, not as a harness-wide change.
- **Dependency injection driver requirement:** the `sqlite3`/`sqlite` driver (via Sequelize's `sqlite3` peer dependency) is declared in `dependencies`, never `devDependencies`, matching the DB-driver rule (Sequelize migrations run at deploy/setup time, not just in tests).
- **Auth:** `bcrypt` for password hashing, `jsonwebtoken` for session tokens (httpOnly cookie), no external SSO — matches the brief's "local auth, no SSO yet."
- **Observability:** structured JSON request/response logging via `pino` (input query text, generated-code hash, output summary, latency, error) to stdout for every agent invocation and every HTTP request; LangSmith tracing enabled for the LangGraph.js graph via `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` env vars (optional — degrades to local `pino` tracing only if the LangSmith key is absent, since LangSmith itself is a third-party account the user may not have created; the `pino` structured logs are the non-optional baseline observability and are wired from Phase 1).
- **E2E testing:** Playwright (`@playwright/test`), `tests/e2e/` at repo root, smoke-tests the full Phase-1 journey against the built, served app.
- **Unit/integration testing:** Vitest (`vitest`) — Node-native, fast, ESM-first; chosen per `harness/patterns/tech-stack.md`'s Node row (`npx vitest run tests/unit/`, `npx vitest run tests/integration/`).

| Key library | Version | Purpose |
|-------------|---------|---------|
| express | ^4.19 | HTTP server + routing |
| @langchain/langgraph | ^0.2 | Agent graph orchestration |
| @google/generative-ai | ^0.21 | Gemini LLM client |
| sequelize | ^6.37 | ORM over SQLite (swappable dialect) |
| sequelize-cli | ^6.6 | Migrations |
| sqlite3 | ^5.1 | SQLite driver (Sequelize dependency) |
| csv-parse | ^5.6 | Streaming CSV parsing |
| bcrypt | ^5.1 | Password hashing |
| jsonwebtoken | ^9.0 | Session tokens |
| pino | ^9.5 | Structured logging |
| multer | ^1.4 | Multipart file-upload handling |
| next | 15.x | Frontend framework |
| react / react-dom | 19.x | Frontend runtime |
| recharts | ^2.13 | Charts (Phase 2) |
| vitest | ^2.1 | Test runner |
| @playwright/test | ^1.48 | E2E tests |

**Avoid:**
- `vm2` — unmaintained, known sandbox-escape CVEs; use `worker_threads` + `vm.Context` instead (see above).
- Loading an entire uploaded CSV into a single synchronous JS string before parsing — always stream via `csv-parse` to stay within the ~500MB target without excess memory.
- Any raw SQL string built by concatenating user input — Sequelize parameterized queries only.
- Sending full raw dataset rows to the Gemini prompt — only schema, small samples (≤20 rows), and computed/aggregated results ever leave the process boundary to the LLM.

## Deployment Model

Single-process Node.js server (Express) serving both the REST API and the statically-exported Next.js frontend on one origin (`http://localhost:8001`, `/app` mount) for local/dev and the Phase-1/2 gate. Long-running service, not a scheduled job — started via `npm run start` (production) or `npm run dev` (dev, with `nodemon`). SQLite file lives on local disk under `data/`; horizontal scaling / MySQL migration is explicitly future work per the roadmap's out-of-scope section.
