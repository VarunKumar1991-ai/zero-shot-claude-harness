# Roadmap

---

## What This Agent Does

The UP Police Data Analyst Agent lets officers and analysts upload CSV files of crime/FIR records (case numbers, offence types, dates, locations) and ask natural-language questions about them — counts, trends, filters, comparisons — and get back a correct plain-language answer backed by real code executed over the real uploaded data, not a canned or sampled guess. It auto-profiles every upload, remembers conversation context within a session so officers can ask follow-ups, and keeps a full server-side audit trail of who ran what, what code executed, and what result came back — because this is a government tool that must survive scrutiny.

## Who Uses It

- **Station-level officers** — occasional use, often mid-investigation: upload one CSV, ask a handful of direct questions, get an answer fast.
- **HQ analysts** — daily use: heavier, more exploratory analysis across multiple files, returning to the same datasets across days.

Both log in with a per-officer username/password (local auth, no SSO yet), purely so every action is attributable in the audit trail.

## Core Problem Being Solved

Today, answering "how many X happened in Y timeframe/place" against raw CSV exports requires someone who can write pandas/SQL, or manual spreadsheet filtering that is slow and error-prone under investigation pressure. This agent gives any officer a natural-language interface to the same rigor a data analyst would apply — real code, real execution, a visible and auditable trail — without needing to know pandas.

## Success Criteria

- [ ] An officer can upload a real FIR/crime CSV and see an accurate profile (columns, row count, date range, data-quality flags) within the same session, with no manual cleanup step required first.
- [ ] A natural-language question like "how many thefts were reported in June?" returns the plain-language answer with the correct number, verifiable by hand against the source CSV.
- [ ] The code that produced any answer is visible on expand and is the exact code that executed (never a placeholder or paraphrase).
- [ ] A follow-up question in the same session ("...and in July?") is answered correctly using conversation context, without re-uploading or re-stating the dataset.
- [ ] Every login, upload, and query — including every retried code attempt — is recorded server-side with a timestamp and the acting user, and is retrievable after a server restart.
- [ ] No raw dataset rows are ever sent to the LLM in a prompt — only schema, capped/redacted samples, and aggregated/computed results.

## What This Agent Does NOT Do (Out of Scope)

- **Phase 1 does not**: join or combine multiple files, persist column/business-rule annotations, render charts, export reports, suggest follow-up questions, or save derived datasets — these are labelled, non-functional stubs in the Phase 1 UI (see Phase 1 below) and become real in Phases 2–3.
- **No SSO / external identity provider** in any planned phase — local username/password only.
- **No per-user data isolation** in any planned phase covered by this roadmap — all logged-in users see all uploaded datasets. Per-user/role-based isolation is a future direction, not scheduled.
- **No MySQL / production-DB integration** in any planned phase covered by this roadmap. The architecture is built so this can be added later without rewriting the analysis layer (see `spec/architecture.md`), but it is not built now.
- **No external integrations** (email, Slack, dashboard export, SIEM feeds) in any planned phase.
- **No millions-of-rows / heavy-concurrency scale** — Phase 1–3 target CSVs up to ~100MB and a handful of concurrent users, per the brief. Not stress-tested at government-wide scale.

## Key Constraints

- Government data-residency posture: cloud LLM calls are acceptable, but raw case-data rows must never be sent to the LLM where avoidable — schemas, capped/redacted samples, and aggregated results only.
- Full server-side audit trail is mandatory from Phase 1: who ran what, what code executed, what result, with timestamps.
- Performance target: CSVs up to ~100MB, answers typically under 30 seconds, designed for concurrent users (not stress-tested at scale in Phase 1–3).
- Malformed/messy CSV data must never be silently corrupted — auto-detect and warn, let the user choose to exclude bad rows or fix and re-upload.
- Production-quality from day one — Phase 1's real path must be correct, not a demo, even though later phases add breadth.

---

## Phases of Development

> **Phase 1 is the smallest first-time-right user-testable win.** It must work perfectly the first time the user tests it — zero rough edges on the tested path. Its backend is minimal but REAL on the one core path (no fake data on the tested path). Its frontend is visually complete: real UI for the one working path PLUS clearly-labelled NON-FUNCTIONAL stubs for everything coming later. Each later phase wires those stubs into real functionality.

### Phase 1 — Login, Upload, Profile, Ask

- **Goal:** A logged-in officer uploads one CSV of FIR/crime records, sees an accurate auto-generated profile, asks a natural-language question, and gets back a correct plain-language answer with the key number — backed by real Gemini-driven code generation executed over the real uploaded data, with the executed code visible on expand. Every step is attributed to the logged-in user and recorded in the audit trail.
- **Independent slices (parallel build units):**
  - `auth-and-audit` (backend) — `User`/`Session`/`AuthEvent`/`QueryRun`/`QueryAttempt` models + Alembic migration, password hashing, session-cookie auth (`get_current_user` dependency), login/logout/me endpoints, audit read endpoints. Deps: none.
  - `dataset-upload-profiling` (backend) — `Dataset`/`DatasetProfile` models (same migration file as above, additive), the `DataSource` protocol + `LocalParquetDataSource`, CSV→Parquet ingestion, quality-flag detection, profiling logic, upload/profile endpoints. Deps: soft dependency on `auth-and-audit`'s `get_current_user` for route guarding (interface only, not implementation — can stub locally until integrated).
  - `query-agent-graph` (backend) — LangGraph state/nodes/edges/assembly (`load_context` → `classify_and_assess` → [`plan_analysis`] → `generate_code` ⇄ `execute_code` ⇄ `inspect_result` → `synthesize_answer` → `suggest_followups`[stub] → `finalize` / `handle_error`), the sandbox executor, conversation-history loading, query + progress-poll endpoints. Deps: `dataset-upload-profiling` (needs `DataSource.get_dataframe`) and `auth-and-audit` (needs `get_current_user` + audit persistence via `QueryRun`/`QueryAttempt`). Build against the documented interfaces from those slices; wire and re-test once all three land.
  - `auth-ui` (frontend) — login screen, session-aware route guard, top-nav shell (Datasets / Ask / Audit Log / logout). Deps: none (built against `spec/api.md`).
  - `upload-profile-ui` (frontend) — CSV upload screen + profile display (columns, row count, date range, quality flags), with a labelled non-functional "Combine with another file" stub. Deps: none.
  - `chat-qa-ui` (frontend) — chat/ask screen: question input, plain-language answer + key numbers, expandable code/attempts panel, real step-counter/progress indicator (polls query status), per-query token/cost display, conversation history for the dataset; labelled non-functional stubs for charts, export, follow-up suggestions, save-as-dataset. Deps: none.
  - `audit-log-ui` (frontend) — read-only audit log screen (filterable table: timestamp, user, action, dataset, summary, status). Deps: none.
- **Key surfaces / files:**
  - `src/db/models.py`, `alembic/versions/0001_initial.py` (all Phase 1 tables)
  - `src/auth/password.py`, `src/auth/session.py`, `src/api/auth.py`, `src/api/audit.py`, `src/domain/auth.py`
  - `src/data_sources/base.py`, `src/data_sources/local_parquet.py`, `src/ingestion/csv_ingest.py`, `src/ingestion/profiling.py`, `src/api/datasets.py`, `src/domain/dataset.py`
  - `src/graph/state.py`, `src/graph/nodes.py`, `src/graph/edges.py`, `src/graph/agent.py`, `src/graph/runner.py`, `src/sandbox/executor.py`, `src/prompts/classify.md`, `src/prompts/plan.md`, `src/prompts/generate_code.md`, `src/prompts/synthesize_answer.md`, `src/api/query.py`, `src/domain/query.py`
  - `frontend/src/app/login/page.tsx`, `frontend/src/app/layout.tsx`, `frontend/src/components/nav.tsx`
  - `frontend/src/app/datasets/page.tsx`, `frontend/src/app/datasets/[id]/page.tsx`
  - `frontend/src/app/datasets/[id]/ask/page.tsx`, `frontend/src/components/chat/*`
  - `frontend/src/app/audit/page.tsx`
  - `frontend/tests/e2e/phase1-journey.spec.ts`
- **Gate command (backend, real Gemini key required in `.env`):**
  ```
  uv run alembic upgrade head && uv run alembic current && uv run pytest tests/unit tests/integration -q
  ```
- **Gate command (frontend styled-render + E2E, run from repo root):**
  ```
  cd frontend && pnpm install && pnpm build
  uv run python -m src
  # in a second terminal, from repo root:
  cd frontend && npx playwright test tests/e2e/ --reporter=line
  ```
- **How the user tests it (handoff seed):**
  1. Run `uv run alembic upgrade head`, then `uv run python -m src`; open `http://localhost:8001/app/`.
  2. Log in with the seeded test officer account (README documents the seed command/credentials).
  3. Upload the sample FIR CSV (README links a real, sizeable sample file). Confirm the profile screen shows real column names, row count, date range, and at least one flagged data-quality issue.
  4. On the Ask screen, ask: "how many thefts were reported in June?" — watch the real step counter progress (not a spinner), then confirm a plain-language answer with the correct count appears, matching a hand count from the CSV.
  5. Expand "Show code" — confirm real pandas code is shown, matching what ran (and, if any attempt failed/retried, that attempt is visible too).
  6. Ask a follow-up: "what about July?" — confirm it answers correctly without re-stating the dataset.
  7. Open the Audit Log screen — confirm the login, the upload, and both queries appear with your username and timestamps.
  8. Note the clearly-labelled (greyed out, "coming soon") stubs for: combine files, charts, export, follow-up suggestions, save-as-dataset — these are intentionally non-functional in Phase 1.

### Phase 2 — Multi-File Analysis + Persistent Context

- **Goal:** Officers can join/compare multiple uploaded CSVs, combine a set of same-schema files (e.g. monthly exports) into one logical dataset, annotate columns/business rules that persist and improve future answers, and save a derived/cleaned analysis result back into their dataset library.
- **Capabilities delivered:** `multi-file-join-and-combine`, `dataset-annotations`, `save-derived-dataset`.
- **Independent slices (parallel build units):**
  - `dataset-grouping` (backend) — `DatasetGroup`/`DatasetGroupMember` models + migration, schema-compatibility check, combine-into-logical-dataset endpoint, multi-dataset query support in `load_context`/`execute_code` (namespace becomes `datasets: dict[str, DataFrame]`). Deps: none beyond Phase 1 tables.
  - `dataset-annotations` (backend) — `DatasetAnnotation` model + migration, CRUD endpoints, wiring annotations into `load_context`'s prompt context. Deps: none.
  - `derived-datasets` (backend) — "save result as dataset" endpoint that materializes a `QueryRun`'s `execution_result` (or a re-run over the full data if the result was capped) into a new `Dataset` row with `source_type="derived"` + lineage pointer. Deps: `dataset-grouping` for consistent `DataSource` handling of derived datasets.
  - `multi-file-ui` (frontend) — file-picker for joins/combine, "same-schema files" combine flow on the upload screen (replaces its Phase 1 stub). Deps: none.
  - `annotations-ui` (frontend) — column annotation editor on the dataset profile screen (replaces its Phase 1 stub). Deps: none.
  - `save-as-dataset-ui` (frontend) — "Save as new dataset" action on the Ask screen (replaces its Phase 1 stub). Deps: none.
- **Key surfaces / files:** `src/db/models.py` (additive), `alembic/versions/0002_multi_file.py`, `src/api/datasets.py`, `src/api/annotations.py`, `src/graph/nodes.py` (extend `load_context`/`generate_code`/`execute_code` for multi-dataset), `frontend/src/app/datasets/**`.
- **Gate command:**
  ```
  uv run alembic upgrade head && uv run pytest tests/unit tests/integration -q
  cd frontend && npx playwright test tests/e2e/ --reporter=line
  ```
- **How the user tests it:** Upload two monthly CSVs with the same columns, combine them into one logical dataset, ask a question that spans both months and confirm the count is the sum across files; add a column annotation (e.g. "IPC_Section = offence code") and confirm a later question referencing that term resolves correctly; save an analysis result as a new dataset and confirm it appears in the dataset list and is independently queryable.

### Phase 3 — Rich Output + Guided Exploration

- **Goal:** Answers come with interactive charts where relevant, an exportable findings report, and 2–3 proactive follow-up question suggestions after every answer — turning the remaining Phase 1 stubs into real features.
- **Capabilities delivered:** `interactive-charts`, `exportable-report`, `followup-suggestions`.
- **Independent slices (parallel build units):**
  - `chart-data-shaping` (backend) — extend `synthesize_answer`/a new `shape_chart_data` node to emit a chart spec (type, series, labels) when the result is trend/comparison-shaped; store on `QueryRun`. Deps: none beyond Phase 1/2 graph.
  - `report-export` (backend) — export endpoint that renders a `QueryRun` (question, answer, key numbers, chart, code) to a downloadable PDF/CSV bundle. Deps: `chart-data-shaping` for chart inclusion.
  - `followup-suggestions` (backend) — turn the Phase 1 `suggest_followups` stub node into a real LLM call grounded in `schema_context` + `final_answer`. Deps: none.
  - `charts-ui` (frontend) — zoomable/filterable bar/line/pie rendering (replaces the Phase 1 charts stub). Deps: `chart-data-shaping`'s response shape.
  - `export-ui` (frontend) — "Export" button wired to the real endpoint (replaces the Phase 1 export stub). Deps: `report-export`.
  - `followups-ui` (frontend) — clickable suggested-question chips after each answer (replaces the Phase 1 stub). Deps: `followup-suggestions`'s response shape.
- **Key surfaces / files:** `src/graph/nodes.py`, `src/graph/state.py`, `src/api/query.py`, `src/reporting/export.py`, `src/prompts/followups.md`, `frontend/src/components/chat/**`.
- **Gate command:**
  ```
  uv run pytest tests/unit tests/integration -q
  cd frontend && npx playwright test tests/e2e/ --reporter=line
  ```
  This is the final requirements phase: additionally confirm `spec/agent.md`'s graph matches the running code (no drift) as part of the gate.
- **How the user tests it:** Ask a trend question ("thefts by month this year") and confirm an interactive, zoomable chart renders with correct values; click Export and confirm a downloadable report contains the answer, chart, and code; confirm 2–3 relevant follow-up chips appear after an answer and clicking one asks that question.

---

## Future Direction (Not Phase-Planned)

Documented for architectural continuity only — **not scheduled for build** in this roadmap:

- **MySQL data source.** Query a large production MySQL database directly (read replicas, caching, query optimization) instead of / alongside uploaded CSVs, with low latency and minimal load on the production DB. `spec/architecture.md` explains how the existing `DataSource` protocol makes this a new implementation, not a rewrite.
- **Per-user / role-based dataset isolation.** Restrict which datasets a given officer/station can see, once the org needs it.
- **External integrations.** Email/Slack notifications, dashboard exports, SIEM/case-management system integration.
