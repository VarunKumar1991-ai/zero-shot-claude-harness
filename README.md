# UP Police Data Analyst Agent

> All commands below run from the **repo root** unless a command block says otherwise.

A data-analyst agent for UP Police. Officers log in, upload a CSV of FIR/crime
records, get an automatic profile of the data, and ask natural-language
questions that are answered by real LLM-generated analysis code executed in a
sandbox over the full uploaded dataset (never a stub, never a sample).

**Stack:** Node.js 20 + Express 4 · LangGraph.js agent graph · Google Gemini
(`@google/generative-ai`) · SQLite via Sequelize + sequelize-cli · Next.js 15 +
React 19 (static-exported, served by the Express backend at `/app` on the
same origin). Full design: `spec/architecture.md`.

**Phase:** Phase 1 — Login, Upload, Profile, Ask (see `spec/roadmap.md`).

---

## 1. Prerequisites

- Node.js 20+
- A Google Gemini API key

## 2. Setup

```
# from repo root
npm install
cd frontend && npm install && cd ..
```

Copy `.env.example` to `.env` and fill in your Gemini key:

```
# from repo root
cp .env.example .env
```

Required in `.env`:

```
AGENT_GEMINI_API_KEY=<your key>
AGENT_JWT_SECRET=<any long random string>
```

(`AGENT_DATABASE_URL`, `PORT`, and the model names already have sensible
defaults in `.env.example`.)

## 3. Database — migrate + seed

```
# from repo root
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all
npx sequelize-cli db:migrate:status
```

`db:migrate:status` must show all five Phase-1 tables (`users`, `datasets`,
`dataset_files`, `queries`, `annotations`) as `up`. The seed step creates one
demo officer account and prints the credentials to the console:

```
username: officer.demo
password: Password123!
```

## 4. Build the frontend (one-time static export)

The Next.js app is a **static export** — there is no separate frontend
server/port. Build it once; the backend serves the output.

```
# from repo root
cd frontend && npm run build && cd ..
```

Re-run this after any frontend change.

## 5. Run the app

```
# from repo root
node src/index.js
```

Open **http://localhost:8001/app/** and log in with the seeded credentials
above.

(`npm run dev` runs the same entrypoint under `nodemon` for backend-only
auto-reload during development; re-run the frontend build step separately
after frontend edits.)

## 6. Try it

1. Log in with `officer.demo` / `Password123!`.
2. Upload a CSV of FIR/crime records — a ready-made sample is at
   `tests/fixtures/sample_fir_500rows.csv` (500 rows, including a handful of
   deliberately malformed rows to exercise data-quality warnings).
3. Confirm the profile card shows real columns, row count, date range, and
   any data-quality flags.
4. Ask a question, e.g. *"How many thefts were reported in June 2025?"* —
   confirm a plain-language answer with the correct number appears.
5. Click **Show code** to see the exact JS analysis code that ran against
   your data.
6. Note the greyed-out **"Coming soon"** placeholders for multi-file join,
   charts, export, annotations, follow-up suggestions, and save-as-dataset —
   these are non-functional Phase-2 stubs, not bugs.

## Tests

```
# from repo root — unit tests (no external calls, fast)
npx vitest run tests/unit

# integration tests — real Gemini API calls, real SQLite (needs .env)
npx vitest run tests/integration

# end-to-end — real server + real Gemini, full browser journey
cd frontend && npm run build && cd ..
npx playwright test tests/e2e
```

Integration and E2E tests call the real Gemini API using the key in `.env`
and are subject to your account's rate/quota limits.

## Project layout

```
src/                    Express backend
  agent/                LangGraph.js graph (load_context -> classify -> plan ->
                         generate_code -> execute_code -> inspect_result ->
                         synthesize_answer -> suggest_followups -> finalize)
  agent/sandbox/         worker_threads + vm.Context sandboxed code execution
  routes/                Express routers (auth, datasets, queries)
  services/               csv parsing, profiling, audit log, auth
  db/                     Sequelize models + config
  llm/                    Gemini client wrapper
  prompts/                LLM prompt templates
migrations/, seeders/    sequelize-cli
frontend/                Next.js app (static export, served at /app)
tests/unit, tests/integration, tests/e2e
spec/                    full product/architecture/agent spec
```

## Notes

- **Audit trail:** every query (who, question, generated code, result,
  timestamps) is persisted to the `queries` table — see `src/services/auditService.js`.
- **Data residency:** prompts sent to Gemini only ever include the dataset's
  schema, a small sample (<=20 rows), and computed/aggregated results —
  never the full raw dataset. See `src/agent/nodes/generateCode.js` and
  `src/prompts/`.
- **Sandbox security:** LLM-generated analysis code runs in a dedicated
  `worker_thread` with its own `vm.Context` — no `require`/`process`/`fs`/
  network access, a hard timeout, and a memory ceiling. See
  `src/agent/sandbox/executor.js`.
