# UI

---

## UI Type

Web dashboard — Next.js 15 + React 19 (TypeScript), Tailwind CSS v4, static-exported and served single-origin by Express at `http://localhost:8001/app/` (per `harness/patterns/tech-stack.md`'s single-origin rule).

## Views / Screens

### Screen: Login

**Purpose:** Officer authenticates before accessing any dataset.

**Key elements:**
- Username + password fields, "Log in" primary button
- Error banner on failed login (plain-language, e.g. "Incorrect username or password")

**Actions available:**
- Submit login → redirects to Dataset List on success

**States:** Empty (fresh form) / Loading (button shows spinner + "Logging in…") / Error (banner) / Ideal (redirect on success).

---

### Screen: Dataset List

**Purpose:** See all uploaded datasets and start a new upload.

**Key elements:**
- "Upload CSV" primary button (opens upload dialog: file picker, optional name field)
- Table/list of existing datasets: name, row count, date range, last-queried timestamp
- Empty state: "No datasets yet — upload a CSV to get started" with the upload action front and center

**Actions available:**
- Upload a new CSV
- Click a dataset row → Dataset Detail screen

**States:** Empty (no datasets — guidance copy + upload CTA) / Loading (skeleton rows while list fetches) / Error (fetch failed — human message + retry button) / Ideal (populated table).

---

### Screen: Upload Flow (dialog/modal within Dataset List)

**Purpose:** Upload a CSV, review the auto-generated profile and any data-quality warnings, confirm or fix-and-retry.

**Key elements:**
- File picker (drag-and-drop + browse), progress bar during upload/parse (real, tied to actual upload progress — never a fake spinner over instant work)
- On success: profile summary (columns, row count, date range)
- If quality flags exist: a clear warning card listing issue types and counts, with two explicit actions: "Exclude bad rows and continue" / "Cancel and re-upload a fixed file" — never auto-resolved silently

**Actions available:**
- Choose file, submit, review flags, exclude-and-continue or cancel

**States:** Empty (no file chosen) / Loading (uploading + parsing, with a real progress indicator since 500MB files take real time) / Error (upload/parse failure — human message, e.g. "That file couldn't be read as CSV — check it's not corrupted") / Ideal (profile shown, flags resolved, dataset created).

---

### Screen: Dataset Detail (Profile + Q&A)

**Purpose:** The core working screen — view the dataset's profile and ask natural-language questions.

**Key elements:**
- **Profile card** (real, Phase 1): columns list with inferred types, row count, date range, quality-flag summary (collapsed, expandable).
- **Q&A panel** (real, Phase 1): chat-style input at the bottom, scrollable history of question/answer turns above it, "Ask" button.
  - Each answer bubble shows: plain-language answer text (rendered via markdown, per `harness/patterns/ui-ux.md`) with key numbers visually emphasized (e.g. a bold stat chip), and any flagged assumptions in a distinct caution-styled inline note.
  - **"Show code" disclosure** (real, Phase 1): expand to reveal the exact generated JS that ran; further expand to see all retry attempts and their outcomes.
  - **Step counter / progress indicator** (real, Phase 1): while a question is running, a small stepper shows the agent's current stage (e.g. "Classifying question… → Generating analysis code… → Running analysis… → Writing answer…"), since this is multi-step work, not instant — never a static spinner with no context.
  - **Token/cost usage badge** (real, Phase 1): small text near each answer, e.g. "812 in / 143 out tokens".
  - **Clarifying-question state**: when the agent asks for clarification instead of answering, it renders as a distinct agent-turn bubble with a clear "the agent needs more detail" visual treatment, and the input is refocused for the officer's reply.
- **Non-functional Phase-1 stubs, clearly labelled "Coming soon" and visually distinct (dimmed, disabled controls, a small badge):**
  - Follow-up-question chips row below each answer (disabled, "Coming soon")
  - "Add annotation" button on the profile card (disabled, "Coming soon")
  - Charts panel tab next to the Q&A tab (disabled, "Coming soon — trend charts")
  - "Export findings" button (disabled, "Coming soon")
  - "Combine with another file" / "Join with another dataset" controls (disabled, "Coming soon")
  - "Save as new dataset" button on each answer (disabled, "Coming soon")

**Actions available (Phase 1 real path):** ask a question, expand code/steps, view profile, review quality flags.

**States:** Empty (no questions asked yet — guidance copy: "Ask a question about this dataset, e.g. 'How many thefts were reported in June?'") / Loading (step-counter progress, per-turn) / Error (a failed run renders a human message in the answer bubble — "Couldn't complete that analysis — the AI service didn't respond. Try again." — never a raw error/stack trace) / Ideal (populated conversation with real answers + code disclosure).

---

## Error States

- Network/API failures anywhere render a human-readable message with a retry action — never a raw stack trace or unhandled blank screen.
- Session expiry (401 on any authenticated call) redirects to Login with a "Your session expired — please log in again" notice, not a silent failure.
- Every stub control (Phase 1) is visually distinguishable from a broken real control: dimmed opacity, a small "Coming soon" badge, and `disabled` state with a tooltip on hover — so it is never mistaken for a bug during Phase 1 testing.

## Tech Stack

Next.js 15 (App Router) + React 19 + TypeScript, Tailwind CSS v4 (`postcss.config.mjs` + `@tailwindcss/postcss`, `@source "../";` in `globals.css` per `harness/patterns/tech-stack.md`), `react-markdown` + `remark-gfm` for rendering agent answers, `recharts` (Phase 2, import present but unused behind the Phase-1 charts stub). Static export mounted by Express at `/app`, single-origin with the API on `:8001`. Playwright (`@playwright/test`) E2E smoke suite in `tests/e2e/` covers the Phase 1 primary journey (login → upload → profile → ask → answer → show code).
