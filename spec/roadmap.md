# Roadmap

---

## What This Agent Does

The UP Police Data Analyst Agent lets police officers upload CSV files of crime/FIR records (case numbers, offence types, dates, locations) and ask natural-language questions about them — counts, trends, filters, comparisons across files. The agent auto-profiles every upload, answers questions by writing and executing real analysis code against the actual uploaded data (never a stubbed or sampled answer), and shows its work (code, steps, reasoning) on request. It keeps a full audit trail of who ran what, on what data, with what result.

## Who Uses It

- **Station-level officers** — occasional use, ad hoc during active investigations. Upload one CSV, ask a handful of questions, get a fast, correct answer.
- **HQ analysts** — daily use. Work across multiple files, return to the same datasets over several days, build up annotations and derived datasets over time.

All users authenticate with a local per-officer username/password (attribution only — no per-user data isolation in Phase 1; every logged-in user can see every uploaded dataset).

## Core Problem Being Solved

Today, answering "how many thefts were reported in June" from a CSV export means opening Excel/manual filtering, or waiting on someone with spreadsheet skills. This agent gives any officer a natural-language interface to their own crime-data exports, with a correct, explainable, auditable answer in under 30 seconds — no spreadsheet expertise required.

## Success Criteria

- [ ] An officer can log in, upload a real FIR/crime CSV (up to ~100MB), and see an accurate auto-generated profile (columns, row count, date range, data-quality flags) within a few seconds.
- [ ] An officer can ask a natural-language question about the uploaded data and receive a plain-language answer with the correct key number(s), computed by real code execution over the full uploaded dataset (not a sample), typically in under 30 seconds.
- [ ] The officer can expand the answer to see the exact code that ran against their data.
- [ ] Every query (who, what code, what result, when) is recorded in a server-side audit log.
- [ ] Malformed/messy rows (bad dates, missing values) are detected and summarized as warnings, never silently dropped or corrupted into results.
- [ ] By the end of Phase 2, an analyst can join/combine multiple CSVs, see charts, export findings, annotate columns, save derived datasets, and get follow-up-question suggestions.

## What This Agent Does NOT Do (Out of Scope)

- No SSO / enterprise auth integration (Phase 1 uses local username/password only).
- No per-user data isolation — all logged-in users share visibility into all uploaded datasets in Phase 1 and Phase 2.
- No direct MySQL / production-database querying (explicitly deferred past Phase 2 — the architecture must not preclude it, but it is not built now).
- No external integrations (email, Slack, dashboard export) in Phase 1 or Phase 2.
- No millions-of-rows / heavy-concurrency scale target — Phase 1/2 target CSVs up to ~100MB and multiple concurrent users, not high-throughput production load.
- No mobile app — web only.

## Key Constraints

- Cloud LLM calls are acceptable, but raw case-data rows must not be sent to the LLM where avoidable — the agent sends schemas, samples (for code-generation context only, never as the basis of the final computed answer), and aggregated/computed results.
- Full server-side audit trail required: user, query text, generated code, result, timestamps.
- Performance target: CSVs up to ~100MB, answers typically under 30 seconds, safe for multiple concurrent users (not stress-tested at scale in Phase 1/2).
- Data must never be silently corrupted: malformed rows are detected, flagged, and only excluded with the user's explicit choice.
- Production-quality from day one — Phase 1 is the smallest slice, not a throwaway demo; there are no shortcuts on the path it delivers.

## Phases of Development

> **Phase 1 is the smallest first-time-right user-testable win.** It must work perfectly the first time the user tests it — zero rough edges on the tested path. Its backend is minimal but REAL on the one core path (no fake data on the tested path). Its frontend is visually complete: real UI for the one working path PLUS clearly-labelled NON-FUNCTIONAL stubs for everything coming later, so the user sees the vision (a stub must never be mistaken for a bug). Each later phase wires those stubs into real functionality, one increment at a time.

### Phase 1 — Login, Upload, Profile, Ask

- **Goal:** A logged-in officer uploads one CSV of FIR/crime records, sees a real auto-generated profile (columns, row count, date range, quality flags), asks one natural-language question, and gets back a correct plain-language answer with the key number(s), computed by real LLM-generated code executed in a sandbox over the full uploaded CSV — with the code visible on expand. This is the full primary journey: auth → upload → profile → ask → answer.
- **Independent slices (parallel build units):**
  - `db-schema` (backend) — Sequelize models + `sequelize-cli` migrations for `users`, `datasets`, `dataset_files`, `queries` (audit log), and the Phase-2-stub `annotations` table (see `data.md`). Seed script (`npx sequelize-cli db:seed:all`) for one test officer account. Deps: none.
  - `auth-api` (backend) — Express routes for login/session (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`), password hashing, session/JWT middleware. Deps: `db-schema` (schema must define `users` table shape first, but auth-api can build against the documented schema in `data.md` in parallel and only needs the migration applied before its own integration test runs).
  - `upload-profile-api` (backend) — `POST /api/datasets` (CSV upload + parse + malformed-row detection), `GET /api/datasets/:id/profile` (auto-profile: columns, row count, date range, quality flags), file storage on disk, `datasets`/`dataset_files` persistence. Deps: `db-schema`.
  - `agent-graph` (backend) — LangGraph.js graph: `load_context → classify → plan → generate_code → execute_code → inspect_result → synthesize_answer → finalize` (Phase 1 wires the full graph; `suggest_followups` node is present as a structural stub that returns an empty list), sandboxed JS code execution via Node `worker_threads` + `vm`, Gemini client wrapper, prompts. Deps: none (consumes a dataset profile + question via function args, not via the HTTP layer directly).
  - `qa-api` (backend) — `POST /api/datasets/:id/queries` (runs the agent graph against a question, persists the audit row, returns the answer), `GET /api/datasets/:id/queries` (history). Deps: `agent-graph`, `upload-profile-api`, `db-schema`.
  - `frontend-shell` (frontend) — Next.js app shell: login page, authenticated layout, dataset list/upload page, dataset detail page shell with profile card + Q&A panel. Deps: none (builds against the documented `api.md` contract, integrates once backend slices land).
  - `frontend-qa-stubs` (frontend) — clearly-labelled non-functional stub UI for: multi-file join picker, charts panel, export button, annotation editor, follow-up-suggestion chips, saved-derived-dataset button. All visibly marked "Coming soon" and disabled. Deps: none.
- **Key surfaces / files:**
  - `db-schema` → `src/db/models/*.js`, `migrations/*.js` (sequelize-cli), `seeders/*.js`, `.sequelizerc`
  - `auth-api` → `src/routes/auth.js`, `src/middleware/session.js`, `src/services/authService.js`
  - `upload-profile-api` → `src/routes/datasets.js`, `src/services/csvParser.js`, `src/services/profiler.js`, `src/storage/`
  - `agent-graph` → `src/agent/graph.js`, `src/agent/state.js`, `src/agent/nodes/*.js`, `src/agent/sandbox/executor.js`, `src/llm/geminiClient.js`, `src/prompts/*.md`
  - `qa-api` → `src/routes/queries.js`, `src/services/auditService.js`
  - `frontend-shell` → `frontend/src/app/login/page.tsx`, `frontend/src/app/datasets/page.tsx`, `frontend/src/app/datasets/[id]/page.tsx`, `frontend/src/components/ProfileCard.tsx`, `frontend/src/components/QAPanel.tsx`, `frontend/src/components/CodeDisclosure.tsx`
  - `frontend-qa-stubs` → `frontend/src/components/stubs/*.tsx` (MultiFileJoinStub, ChartsStub, ExportStub, AnnotationStub, FollowupChipsStub, SaveDerivedStub)
- **Gate command:** `npx sequelize-cli db:migrate && npx sequelize-cli db:seed:all && npx sequelize-cli db:migrate:status` (migration proof step — status output must list all five Phase-1 tables as `up`: `users`, `datasets`, `dataset_files`, `queries`, `annotations`) followed by `npx vitest run tests/unit tests/integration --reporter=verbose` (backend, real Gemini key from `.env` + the real SQLite DB just migrated) and `npx playwright test tests/e2e/phase1.spec.ts --reporter=line` (frontend, against the app served by the backend at `:8001/app/` after `cd frontend && npm run build` has produced the static export in `frontend/out/`). All must be green. The integration suite's data-processing test **must** run against `tests/fixtures/large_fir_50000rows.csv` (≥50,000 rows, generated with a pre-computed known-correct count for a specific offence-type/month combination) and assert the agent's returned count exactly matches the pre-computed value — per `harness/patterns/test-driven.md`'s data-processing gate rule, this dataset size is deliberately far beyond any plausible LLM-prompt sample size, so a sampling-based (rather than full-code-execution) implementation would fail this assertion.
- **How the user tests it (handoff seed):**
  1. From repo root: `npm run migrate` (runs `sequelize-cli db:migrate` + `db:seed:all`, seeds one officer account printed to console), then `npm run dev` (backend on `:8001` — the only long-running server) and, in a second terminal, `cd frontend && npm run build` (a one-time static export into `frontend/out/`; no separate frontend server or port — the already-running backend serves the built app at `http://localhost:8001/app/` via the single-origin path — see `architecture.md`).
  2. Open `http://localhost:8001/app/`, log in with the seeded officer credentials shown in the migration output.
  3. Upload a real FIR/crime CSV (a sample fixture is provided at `tests/fixtures/sample_fir_500rows.csv`, or use your own).
  4. Confirm the profile card shows real columns, row count, date range, and any data-quality warnings for the uploaded file.
  5. Ask: "How many thefts were reported in June?" (or a question matching your own data) — confirm a plain-language answer appears with the correct number, computed against the real file.
  6. Click "Show code" to confirm the exact JS analysis code that ran is visible.
  7. Note the clearly-labelled "Coming soon" stubs for multi-file join, charts, export, annotations, follow-up suggestions, and save-as-dataset — these are non-functional placeholders, not bugs.

> **Assumed:** cross-turn conversation memory (the agent recalling a prior question/answer within the same session to resolve a follow-up like "what about July?") is deferred to Phase 2, not Phase 1. The brief's explicit Phase-1 core path is a single upload → profile → one question → one answer journey; every question in Phase 1 is answered independently, with each Q&A turn stored to the audit log but not fed back into a later run's prompt as `conversationHistory` (that wiring, and the `sessionId`-scoped history read in `load_context`, ships in Phase 2 alongside `suggest_followups`, per `agent.md`). This keeps Phase 1 to the smallest first-time-right slice; Phase 2 explicitly closes this gap so multi-turn follow-ups work before the roadmap is considered "primary journey complete."

### Phase 2 — Multi-File, Charts, Annotations, Export, Follow-ups

- **Goal:** Wires every Phase-1 stub into a real feature: officers can combine same-schema CSVs into one logical dataset and join/compare separate datasets, see interactive charts for trend questions, export findings, annotate columns with business-rule context that persists and improves future answers, get 2–3 suggested follow-up questions after every answer, and save a derived/cleaned analysis result back into the dataset library. Conversation history within a session (follow-up questions that reference prior turns) is wired in this phase.
- **Independent slices (parallel build units):**
  - `multi-file-combine-api` (backend) — schema-matching + combine logic for same-schema CSVs into one logical dataset; join support across datasets with distinct schemas for compare questions. Deps: none (extends `upload-profile-api` surfaces, disjoint new routes/files).
  - `annotations-api` (backend) — `POST/GET /api/datasets/:id/annotations` (persist column/business-rule notes), wiring annotations into the `agent-graph`'s `load_context` node prompt. Deps: none (new table + route; graph already reads context via a documented interface).
  - `charts-export-api` (backend) — extend `synthesize_answer`/new `build_chart` node to emit chart-ready JSON (bar/line/pie series) for trend questions; `GET /api/datasets/:id/queries/:qid/export` (CSV/PDF-of-findings download). Deps: none (new node + route, disjoint from other slices).
  - `followups-history-api` (backend) — implement the real `suggest_followups` node (replacing the Phase-1 stub) and add conversation-history read/write so follow-up questions see prior turns in the same session; `save-derived-dataset` endpoint (`POST /api/datasets/:id/queries/:qid/save-as-dataset`). Deps: none (extends `agent-graph` node + new route, disjoint files).
  - `frontend-charts-export-annotations` (frontend) — replace chart/export/annotation stubs with real interactive components (zoomable/filterable bar/line/pie via a charting library), export button wired to the download endpoint, annotation editor UI. Deps: `charts-export-api`, `annotations-api` (frontend consumes their contracts, but frontend component code is on disjoint files and can be scaffolded in parallel against `api.md`, wired last).
  - `frontend-multifile-followups` (frontend) — replace multi-file-join and follow-up-chip stubs with real UI: file-combine picker, join/compare selector, clickable follow-up-question chips, save-as-dataset button, per-query token/cost display, step-counter progress indicator wired to real graph step events. Deps: `multi-file-combine-api`, `followups-history-api` (same disjoint-file caveat as above).
- **Key surfaces / files:**
  - `multi-file-combine-api` → `src/services/datasetCombiner.js`, `src/routes/datasets.js` (extend)
  - `annotations-api` → `src/routes/annotations.js`, `src/services/annotationService.js` (the `annotations` table already exists from the Phase 1 migration; no new migration needed)
  - `charts-export-api` → `src/agent/nodes/buildChart.js`, `src/services/exportService.js`, `src/routes/queries.js` (extend)
  - `followups-history-api` → `src/agent/nodes/suggestFollowups.js`, `src/services/conversationHistory.js`, `src/routes/queries.js` (extend)
  - `frontend-charts-export-annotations` → `frontend/src/components/ChartsPanel.tsx`, `frontend/src/components/ExportButton.tsx`, `frontend/src/components/AnnotationEditor.tsx`
  - `frontend-multifile-followups` → `frontend/src/components/MultiFileJoinPicker.tsx`, `frontend/src/components/FollowupChips.tsx`, `frontend/src/components/SaveDerivedButton.tsx`, `frontend/src/components/StepProgress.tsx`, `frontend/src/components/CostBadge.tsx`
- **Gate command:** `npx vitest run tests/unit tests/integration --reporter=verbose` (backend, real Gemini key, real SQLite, fixture set exceeding 100k rows across combined files to force a full-data-vs-sample difference — see `tests/fixtures/large_combined/`) followed by `npx playwright test tests/e2e/phase2.spec.ts --reporter=line`.
- **How the user tests it (handoff seed):**
  1. Same run commands as Phase 1 (already includes Phase 2 routes/pages).
  2. Upload two same-schema monthly CSVs; confirm they combine into one logical dataset with the combined row count in the profile.
  3. Upload a second, differently-shaped dataset and ask a question comparing the two; confirm a real join-based answer.
  4. Ask a trend question ("thefts per month this year") and confirm a real interactive bar/line chart renders, zoomable/filterable.
  5. Add a column annotation (e.g. "IPC_Section = offence code") and ask a follow-up question that depends on it; confirm the annotation affects the answer.
  6. After an answer, click one of the 2–3 suggested follow-up chips and confirm it asks a real, sensible follow-up.
  7. Click "Export" and confirm a real findings file downloads.
  8. Click "Save as new dataset" on a query result and confirm it appears in the dataset list as a new reusable dataset.
  9. Confirm the step-counter/progress indicator and per-query token/cost badge are real and update per query.

> **Assumed:** the future MySQL production-data-source phase (explicitly out of scope for Phase 1/2 per the brief) is not planned here as a numbered phase — the architecture's swappable data-source-layer principle (see `architecture.md`) is the only forward-looking commitment made now, per the brief's instruction not to build it yet.
