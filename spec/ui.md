# UI

---

## UI Type

Web dashboard — chat-style Q&A over uploaded datasets, plus upload/profile and audit screens. Next.js 15 + React 19, statically exported and served by FastAPI at `/app/` (see `spec/architecture.md` → Stack; single-origin is the canonical run/test path per `harness/patterns/tech-stack.md`).

## Views / Screens

### Screen: Login

**Purpose:** authenticate before anything else is reachable.

**Key elements:**
- Username + password fields, "Log in" button
- Error banner on invalid credentials ("Incorrect username or password")

**Actions available:**
- Submit login → on success, redirect to Datasets

**States:** empty (fresh form), loading (button disabled + spinner while `POST /auth/login` is in flight), error (banner as above), ideal (redirects away on success, so no populated state to show here).

---

### Screen: Datasets (list)

**Purpose:** see all uploaded datasets and start a new upload.

**Key elements:**
- Table: name, row count, uploaded-by, status, created date — click a row to open its profile
- "Upload CSV" primary action

**Actions available:**
- Upload a new CSV
- Open an existing dataset's profile/ask screen

**States:**
- **Empty** — "No datasets yet. Upload a CSV to get started." + the Upload action, not a blank table.
- **Loading** — skeleton rows while `GET /datasets` is in flight.
- **Error** — "Couldn't load datasets — retrying" style message, never a raw error.
- **Ideal** — populated table.

---

### Screen: Upload CSV

**Purpose:** upload one file and immediately see its real profile — this is a core, real (non-stub) step of the Phase 1 journey.

**Key elements:**
- File picker (drag-and-drop + browse), accepts `.csv`, shows the `AGENT_MAX_CSV_MB` limit up front
- Upload progress (real — reflects the actual upload/ingest request, never a fake bar)
- On success: **Profile panel** — row count, column list with dtype/null-count/sample values, detected date range, and a **Data Quality** section listing every detected issue (type, column, affected row count, examples) with plain-language phrasing
- **[STUB — Phase 2, labelled "Combine with another file (coming soon)"]** a visibly greyed-out, disabled control next to the profile, so it reads as a preview of what's next, never as a bug
- "Ask a question about this dataset" primary action → Ask screen

**Actions available:**
- Upload
- (Phase 1) proceed to Ask
- (Phase 2, currently disabled) combine with another same-schema file

**States:**
- **Empty** — picker with instructions and the size limit stated.
- **Loading** — real upload/ingest progress, not instant-feeling for a 100MB file.
- **Error** — file-too-large or unparseable-CSV message naming the specific problem (e.g. "File exceeds the 100MB limit" / "No columns could be detected — is this a valid CSV?").
- **Ideal** — full profile + quality-issues panel populated with real detected values.

---

### Screen: Ask (chat/Q&A)

**Purpose:** the primary journey — ask natural-language questions and get real, code-backed answers, with conversation memory within the dataset.

**Key elements:**
- Conversation history for this dataset (loaded from `GET /datasets/{id}/conversation`), rendered as chat bubbles (question / answer), markdown-rendered per `harness/patterns/ui-ux.md` (never raw `**bold**`/bullet syntax)
- Question input + "Ask" button
- **Real step-counter / progress indicator** while a query runs — polls `GET .../queries/{id}` and shows the actual `current_node` (e.g. "Step 2 of ~5: writing analysis code…"), never a generic spinner over multi-second work
- Answer bubble: plain-language answer, **key numbers** highlighted, and — if present — an **assumptions** callout ("Assumption: interpreted 'cases' as FIRs filed, not convictions") rendered distinctly (never buried in prose)
- **"Show code" expandable panel** on every answer: the exact executed code, and if there were failed attempts, each prior attempt (code + error) is listed too, oldest first
- **Per-query token/cost usage** shown small, near the answer (e.g. "2,160 tokens · $0.004")
- **[STUB — Phase 3, labelled "Chart (coming soon)"]** a greyed-out chart placeholder under trend-shaped answers
- **[STUB — Phase 3, labelled "Export (coming soon)"]** a disabled Export button
- **[STUB — Phase 3, labelled "Suggested follow-ups (coming soon)"]** greyed-out chip row under the answer
- **[STUB — Phase 2, labelled "Save as new dataset (coming soon)"]** disabled action near the result

**Actions available:**
- Ask a question
- Expand code/attempts
- (Phase 1) none of the stub actions are clickable — each carries a `title`/tooltip explaining it's coming in a later phase

**States:**
- **Empty** — "Ask anything about this dataset — e.g. 'How many thefts were reported in June?'" with 1–2 example questions, before any question has been asked.
- **Loading** — the real step-counter described above.
- **Error** — a clarifying-question response renders as a distinct "I need more detail" bubble with the agent's question and a way to re-ask; a hard failure renders "Something went wrong generating this answer — please try again" (never a stack trace), matching `handle_error`'s state.
- **Ideal** — full answer with key numbers, code panel, and token/cost line.

---

### Screen: Audit Log

**Purpose:** read-only, filterable record of every login, upload, and query — real in Phase 1, since server-side audit is a Phase 1 capability.

**Key elements:**
- Filter bar: user, dataset, date range
- Table: timestamp, user, action type, dataset (if applicable), summary — clicking a query row opens its full detail (all attempts' code/result/error) via `GET /audit/{query_run_id}`

**Actions available:**
- Filter
- Drill into a query's full attempt history

**States:**
- **Empty** — "No activity yet" (unlikely in practice once logins exist, but designed anyway).
- **Loading** — skeleton rows.
- **Error** — plain-language load failure message.
- **Ideal** — populated, filterable table.

## Error States

Every fetch in this UI follows the same pattern (matching `harness/patterns/code.md`'s error-handling doctrine): network/parse failures render a human message ("Couldn't reach the server — is it running?"), never a raw exception; API `4xx`/`5xx` responses render the `detail.message` from the envelope; a `status: "failed"` query result renders `error` in the answer bubble, not as a browser alert or console-only failure. Destructive-feeling actions (Phase 1 has none — no delete endpoints exist) would require confirmation per `harness/patterns/ui-ux.md`; none apply yet.

## Tech Stack

Next.js 15 + React 19, static export (`output: 'export'`, `basePath: '/app'`) served by FastAPI at `/app/`, Tailwind v4 for styling (matches the existing skeleton's `postcss.config.mjs` + `@source` setup — extended, never overwritten). `react-markdown` + `remark-gfm` for rendering LLM-generated answer text. Playwright for the `frontend/tests/e2e/` smoke suite (primary journey: login → upload → profile → ask → answer with code expanded).
