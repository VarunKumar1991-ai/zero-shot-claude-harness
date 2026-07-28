# Agent

> Required: this project uses LangGraph.js. The graph below is the backbone for every phase; Phase 1 wires the full topology, with `suggest_followups` returning a structural stub (empty list) until Phase 2.

---

## Agent Architecture Pattern

**Chosen: Graph (LangGraph.js)**, composing three catalogue patterns from `harness/patterns/agentic-ai.md`:

- **#22 LLM-Generated Code Execution** (the backbone) — for any natural-language question over the uploaded CSV, the agent has Gemini write real JavaScript analysis code and runs it against the actual data, rather than mapping questions onto a fixed op-list. This is required because officers' questions are open-ended (counts, filters, trends, comparisons) and a rigid interpreter would silently fail on anything not pre-anticipated.
- **#6 Planning** — for complex/multi-step questions, an explicit `plan` node runs before code generation; the `classify` node fast-paths simple counts/filters straight to `generate_code`, skipping planning overhead per the brief ("simple counts/filters in one fast pass").
- **#12 Exception Handling and Recovery** — `execute_code` and `inspect_result` feed a bounded retry loop back to `generate_code` on execution failure or a low-confidence inspection, per the brief's "retry internally with a different approach before giving up."

Rejected: a plain ReAct tool-loop without a graph was considered but rejected because the retry-with-different-strategy requirement and the plan/fast-path branch are cleaner as explicit conditional edges than as one undifferentiated loop; a multi-agent architecture was rejected as overkill — one agent with tools and a bounded retry loop meets every Phase 1/2 requirement.

---

## LLM Provider & Model

| Agent / Node | Provider | Model ID | Rationale |
|-------------|----------|----------|-----------|
| `classify` | Gemini | `gemini-2.5-flash` | Cheap single-label classification (simple vs. complex, clarify-needed), latency matters most |
| `plan` | Gemini | `gemini-3.1-pro` | Multi-step strategy needs stronger reasoning; only invoked for complex questions |
| `generate_code` | Gemini | `gemini-3.1-pro` | Code correctness matters most; higher-quality model justified since it also drives the retry loop |
| `inspect_result` | Gemini | `gemini-2.5-flash` | Cheap sanity-check of a small computed result (shape/plausibility), not a full reasoning task |
| `synthesize_answer` | Gemini | `gemini-3.1-pro` | User-facing prose quality matters; drafts the plain-language answer and assumption flags |
| `suggest_followups` | Gemini | `gemini-2.5-flash` | Phase 2 — short, cheap suggestion generation |

Model IDs are env-configurable (`AGENT_LLM_MODEL_PRIMARY` defaults to `gemini-3.1-pro`, `AGENT_LLM_MODEL_FAST` defaults to `gemini-2.5-flash`) so they can change without a code deploy, per `harness/patterns/tech-stack.md`'s model-naming rule.

**Fallback behaviour:** each Gemini call is wrapped with retry + exponential backoff (up to 3 attempts, 500ms/1500ms/4000ms) for transient 429/5xx errors. If all attempts are exhausted, the node sets `state.error` with a clear cause (`"llm_unavailable"`) and the graph routes to `handle_error`, which persists a failed-query audit row and returns a plain-language "the analysis service is temporarily unavailable, please try again" message — never a fabricated answer.

**Prompt strategy:** system/user split per node, prompts stored as `.md` templates in `src/prompts/`. `generate_code` and `synthesize_answer` request **structured output** (Gemini's JSON-mode response schema) so the graph can parse `{ code: string, explanation: string }` and `{ answer: string, keyNumbers: object[], assumptions: string[] }` reliably rather than parsing free text. Few-shot examples of the sandbox's exact JS contract (see below) are embedded in the `generate_code` system prompt so the LLM never invents disallowed APIs (`require`, `fetch`, file I/O).

---

## Tools & Tool Calling

This agent does not use LangChain's generic "tool calling" abstraction for external APIs (no web search, no third-party APIs) — its one "tool" is the code sandbox itself, modeled as a graph node rather than a bound tool, because its input (generated code string) and output (execution result + captured errors) are graph-native and don't need the LLM to choose *whether* to call it — the graph always calls it after `generate_code`.

| Tool name | Description | Inputs | Output | Side-effects |
|-----------|-------------|--------|--------|--------------|
| `sandboxExecute` | Runs LLM-generated JS in an isolated worker against the in-memory dataset | `{ code: string, rows: RowObject[] }` | `{ result: any, stdout: string[], error: string \| null, durationMs: number }` | None external — pure in-process compute, no DB/network/file writes |

**Tool selection strategy:** N/A — the sandbox is always invoked after `generate_code`; there is no LLM choice of tool.

**Tool failure handling:** a sandbox error (thrown exception, timeout, memory limit) is captured as `{ error: <message> }` and fed back into `generate_code` on the retry edge with the failure context, up to `MAX_CODE_RETRIES` (default 2, i.e. 3 total attempts) before falling to `handle_error`.

---

## Agent State

```javascript
// src/agent/state.js — LangGraph.js state channel definitions (Annotation.Root)

const AgentState = Annotation.Root({
  // Identity
  runId: Annotation(),              // set at initialisation (uuid, matches queries.id)
  userId: Annotation(),             // set at initialisation, from session
  datasetId: Annotation(),          // set at initialisation

  // Input
  question: Annotation(),           // the officer's natural-language question
  conversationHistory: Annotation({ // Phase 2: prior {question, answer} turns in this session
    default: () => [],
  }),

  // Dataset context (populated by load_context)
  datasetProfile: Annotation(),     // { columns, rowCount, dateRange, qualityFlags } from profiler
  annotations: Annotation({ default: () => [] }), // Phase 2: user-provided column/business-rule notes
  sampleRows: Annotation({ default: () => [] }),  // ≤20 rows, for LLM prompt context ONLY — never the full dataset
  rows: Annotation(),               // full parsed dataset — in-process only, NEVER placed in an LLM prompt

  // Classification / planning
  complexity: Annotation(),         // "simple" | "complex" | "needs_clarification"
  clarifyingQuestion: Annotation(), // set when complexity === "needs_clarification"
  plan: Annotation({ default: () => [] }), // ordered list of step descriptions, only for "complex"

  // Code generation / execution loop
  generatedCode: Annotation(),      // latest generated JS string
  codeExplanation: Annotation(),    // LLM's one-line rationale for the code
  executionResult: Annotation(),    // { result, stdout, error, durationMs } from sandboxExecute
  attempts: Annotation({ default: () => [] }), // history of {code, executionResult, inspection} per retry — shown on "show steps" disclosure
  retryCount: Annotation({ default: () => 0 }),

  // Inspection
  inspectionVerdict: Annotation(),  // "ok" | "retry" | "give_up"
  inspectionNote: Annotation(),     // LLM's reasoning for the verdict

  // Output
  answer: Annotation(),             // final plain-language answer text
  keyNumbers: Annotation({ default: () => [] }), // [{label, value}]
  assumptions: Annotation({ default: () => [] }), // flagged assumptions, if the agent proceeded despite uncertainty
  chartSpec: Annotation({ default: () => null }), // Phase 2: {type, series} for trend questions
  followups: Annotation({ default: () => [] }),   // Phase 2: 2-3 suggested next questions (Phase 1: always [])
  tokenUsage: Annotation({ default: () => ({ promptTokens: 0, completionTokens: 0 }) }),

  // Control
  error: Annotation({ default: () => null }),      // set by any node on fatal failure
  status: Annotation({ default: () => "running" }), // "running" | "completed" | "failed" | "needs_clarification"
});
```

---

## Nodes / Steps

### `load_context`

**Reads from state:** `datasetId`, `userId`
**Writes to state:** `datasetProfile`, `annotations`, `sampleRows`, `rows`
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite (via Sequelize) | Load dataset profile + Phase-2 annotations | Fatal — sets `error`, routes to `handle_error` |
| Disk | Load + parse the stored CSV into `rows` | Fatal — sets `error` |

**Behaviour:** Loads the persisted dataset profile and any saved annotations, re-parses the CSV file from disk into typed row objects (or reads a cached in-memory parse for the process if already loaded this session), and takes a small representative sample (≤20 rows) for LLM prompt context. `rows` (the full dataset) stays in the Node process and is never serialized into a prompt.

### `classify`

**Reads from state:** `question`, `datasetProfile`, `conversationHistory`
**Writes to state:** `complexity`, `clarifyingQuestion`
**LLM call:** yes — Gemini Flash, prompt: `src/prompts/classify.md`; structured JSON output `{ complexity, clarifyingQuestion? }`
**External calls:** none beyond the LLM call itself (see fallback behaviour above)
**Behaviour:** Determines whether the question is a simple count/filter (fast path, skip planning), a complex multi-step question (needs `plan`), or too ambiguous to answer confidently (routes to a clarifying-question response instead of guessing blind). Per the brief, ambiguity prefers asking a clarifying question first.

### `plan`

**Reads from state:** `question`, `datasetProfile`, `complexity`
**Writes to state:** `plan`
**LLM call:** yes — Gemini Pro, prompt: `src/prompts/plan.md`; structured output `{ steps: string[] }`
**External calls:** none
**Behaviour:** Only runs when `complexity === "complex"`. Produces an ordered list of analysis sub-steps (e.g. "1. Filter rows to June, 2. Filter to offence_type=theft, 3. Count rows") that is passed into `generate_code`'s prompt as guidance, not executed step-by-step itself — the plan shapes one code-generation call, per the brief's "planning a strategy first for complex questions."

### `generate_code`

**Reads from state:** `question`, `datasetProfile`, `sampleRows`, `plan`, `attempts` (prior failed attempts, if any retry)
**Writes to state:** `generatedCode`, `codeExplanation`
**LLM call:** yes — Gemini Pro, prompt: `src/prompts/generate_code.md`; structured output `{ code, explanation }`. Prompt includes the documented sandbox contract (available variable `rows`, whitelisted helpers, forbidden APIs) and, on retry, the prior attempt's code + error so the model tries a different approach rather than repeating the same mistake.
**External calls:** none
**Behaviour:** Produces a JS snippet that computes the answer from `rows` and assigns it to a `result` variable. Never given the full dataset in-prompt — only schema + ≤20 sample rows + (on retry) the prior failing snippet and its error message.

### `execute_code`

**Reads from state:** `generatedCode`, `rows`
**Writes to state:** `executionResult`, `attempts` (appends this attempt)
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| Sandbox worker (`worker_threads`) | `sandboxExecute({ code, rows })` | Captured as `executionResult.error`, NOT fatal — routes to `inspect_result`, which decides retry vs. give-up |

**Behaviour:** Runs the generated code in the isolated worker (see `architecture.md` → Sandboxed code execution). Always returns a result object even on failure (never throws past this node) so `inspect_result` can uniformly reason about success and failure.

### `inspect_result`

**Reads from state:** `executionResult`, `question`, `retryCount`
**Writes to state:** `inspectionVerdict`, `inspectionNote`
**LLM call:** yes — Gemini Flash, prompt: `src/prompts/inspect_result.md`; structured output `{ verdict, note }`. Skipped (auto `"ok"`) when `executionResult.error` is null AND the result is a plain number/small array — a fast deterministic check — to avoid an LLM round-trip on the common simple-count case; only invoked for ambiguous/complex/errored results.
**External calls:** none
**Behaviour:** Sanity-checks whether the execution result plausibly answers the question (right shape, right order of magnitude, no execution error) and whether the retry budget (`retryCount < MAX_CODE_RETRIES`) allows another attempt. Verdict `"ok"` → `synthesize_answer`; `"retry"` (and budget remains) → back to `generate_code` with `retryCount += 1`; `"give_up"` or exhausted budget → `synthesize_answer` anyway, but with `assumptions` flagged so the agent gives its best guess with a clear caveat, per the brief.

### `synthesize_answer`

**Reads from state:** `question`, `executionResult`, `inspectionVerdict`, `attempts`, `datasetProfile`
**Writes to state:** `answer`, `keyNumbers`, `assumptions`, `tokenUsage`
**LLM call:** yes — Gemini Pro, prompt: `src/prompts/synthesize_answer.md`; structured output `{ answer, keyNumbers, assumptions }`. Only the **computed result** (numbers/small tables), not raw rows, is sent to the LLM here.
**External calls:** none
**Behaviour:** Turns the computed result into a plain-language answer with key numbers called out, flagging any assumptions the agent made (e.g. "assumed 'theft' includes IPC sections 379–382") when `inspectionVerdict !== "ok"` or the question was ambiguous.

### `suggest_followups` (Phase 2; Phase 1 structural stub)

**Reads from state:** `question`, `answer`, `datasetProfile`
**Writes to state:** `followups`
**LLM call:** Phase 1 — no (returns `[]` unconditionally, a deliberate stub per the roadmap). Phase 2 — yes, Gemini Flash, prompt: `src/prompts/suggest_followups.md`.
**External calls:** none
**Behaviour:** Phase 1: no-op passthrough so the graph shape and `finalize` contract are stable from day one (per `phases.md`'s "agentic stack wired from day one" rule) even though the feature isn't user-visible yet. Phase 2: generates 2–3 relevant next questions.

### `handle_error`

**Reads from state:** `error`, `runId`
**Writes to state:** `status = "failed"`
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | Persist failed-query audit row (`status=failed`, `error`) | Logged only — never throws past this node |

**Behaviour:** Terminal failure handler. Always persists an audit row (even on failure — the brief requires auditing "who ran what query," including failed ones) and returns a clear, human error message, never a stack trace, to the API layer.

### `finalize`

**Reads from state:** everything
**Writes to state:** `status = "completed"` (or `"needs_clarification"` if `classify` routed here directly)
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | Persist the completed query audit row: question, generated code (final + all attempts), result, answer, timestamps, token usage | Fatal — sets `error`, but graph has already produced an answer, so the API layer still returns the answer to the user and logs the persistence failure separately (answer delivery is not blocked by audit-write failure) |

**Behaviour:** Assembles the final API response shape and writes the full audit trail.

---

## Graph / Flow Topology

```
START
  │
  ▼
load_context ──(error)──► handle_error ──► END
  │
  ▼
classify ──(error)──► handle_error ──► END
  │
  ├──(complexity == "needs_clarification")──► finalize (status=needs_clarification) ──► END
  │
  ├──(complexity == "complex")──► plan ──► generate_code
  │
  └──(complexity == "simple")───────────────► generate_code
                                                    │
                                                    ▼
                                              execute_code
                                                    │
                                                    ▼
                                              inspect_result
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        │ (verdict=="retry" AND      │ (verdict=="ok" OR         │
                        │  retryCount < MAX)         │  give_up/budget exhausted)│
                        ▼                            ▼                          
                  generate_code (retryCount+1)  synthesize_answer
                                                       │
                                                       ▼
                                              suggest_followups
                                                       │
                                                       ▼
                                                   finalize
                                                       │
                                                       ▼
                                                      END
```

**Conditional edges:**

| Source node | Condition | Target |
|-------------|-----------|--------|
| `load_context` | `state.error` is set | `handle_error` |
| `load_context` | else | `classify` |
| `classify` | `state.error` is set | `handle_error` |
| `classify` | `complexity === "needs_clarification"` | `finalize` |
| `classify` | `complexity === "complex"` | `plan` |
| `classify` | `complexity === "simple"` | `generate_code` |
| `plan` | always | `generate_code` |
| `generate_code` | always | `execute_code` |
| `execute_code` | always | `inspect_result` |
| `inspect_result` | `verdict === "retry" && retryCount < MAX_CODE_RETRIES` | `generate_code` |
| `inspect_result` | `verdict === "ok"` OR (`verdict === "retry" && retryCount >= MAX_CODE_RETRIES`) OR `verdict === "give_up"` | `synthesize_answer` |
| `synthesize_answer` | always | `suggest_followups` |
| `suggest_followups` | always | `finalize` |
| `handle_error` | always | `END` |
| `finalize` | always | `END` |

---

## Memory & Context

| Scope | Mechanism | What is stored |
|-------|-----------|----------------|
| **Within a run** | LangGraph.js state (in-memory during graph execution) | All fields above |
| **Across runs (same dataset, any day)** | SQLite `queries` table | Every past question, generated code, result, answer, timestamps — persisted so datasets and their query history survive across sessions and days per the brief |
| **Conversation (within a session)** | `queries` table filtered by `sessionId`, loaded into `conversationHistory` at `load_context` (Phase 2) | The last N (default 10) `{question, answer}` pairs from the current login session, so follow-up questions can reference prior turns |

**Context window management:** only the last N conversation turns (summarized to `{question, answer}` pairs, not full code/reasoning traces) are included in the `classify`/`generate_code` prompts; sample rows are capped at 20; the full dataset is never placed in any prompt — this keeps every prompt well within Gemini's context window regardless of dataset size.

---

## Human-in-the-Loop Checkpoints

| Checkpoint | What is shown to the user | Expected user action | Timeout / default |
|------------|--------------------------|----------------------|-------------------|
| Clarifying question (`classify` → `needs_clarification`) | The agent's specific clarifying question, in place of an answer | Reply with clarification (submitted as a new question to the same session) | No timeout — the officer can also just re-ask more specifically; no forced default |
| Malformed-row exclusion choice (upload-time, not graph-internal) | Data-quality warning summary with counts of affected rows | Choose "exclude bad rows and continue" or "cancel and re-upload fixed file" | No timeout — upload stays pending until the officer chooses |

---

## Error Handling & Recovery

**Node-level:** every node wraps its LLM/DB/sandbox calls in try/catch; a caught exception sets `state.error` with a short machine-readable cause code (`llm_unavailable`, `db_error`, `parse_error`, `sandbox_crash`) and routes to `handle_error` via the node's conditional edge, except `execute_code` failures, which are recoverable and routed to `inspect_result`/retry instead of `handle_error` (a code bug is not a fatal system error).

**Graph-level (`handle_error` node):**
- Reads: `state.error`, `state.runId`, `state.userId`, `state.datasetId`
- Updates DB: audit row status → `"failed"`, `error_message` set, `completed_at` set
- Logs error via `pino` with `runId` context
- Terminates graph (routes to `END`)

**Resume / retry strategy:** a failed run is not resumed from a checkpoint (LangGraph.js checkpointing is not enabled in Phase 1/2 — see Concurrency Model); the officer simply re-asks the question, which starts a fresh run. The `attempts` array within a single run provides the internal retry-with-different-approach behavior the brief asks for; that retry is bounded (`MAX_CODE_RETRIES = 2`) and internal to one graph invocation, not a cross-run resume.

**Partial failure:** a `finalize` DB-write failure (see `finalize` node above) does not block returning the already-computed answer to the officer — it is logged and surfaced in structured logs for follow-up, since losing the *answer* to a working query would be worse than a delayed audit write. All other partial failures (e.g. `suggest_followups` erroring) degrade gracefully: `suggest_followups` catches its own errors internally and defaults to `followups: []` rather than failing the whole run, since follow-up suggestions are a non-critical enhancement.

---

## Observability

| Signal | What | Where |
|--------|------|-------|
| **Trace** | One trace per graph run, one span per node | LangSmith (if `LANGCHAIN_TRACING_V2=true` + key set) — see `architecture.md` |
| **LLM calls** | Prompt tokens, completion tokens, latency, model, node name | `pino` structured log line per call + LangSmith span |
| **Sandbox execution** | Code hash, duration, success/error, retry count | `pino` structured log line |
| **Run outcome** | Status, total duration, error if any, `runId` | SQLite `queries` row + `pino` structured log line |

---

## Concurrency Model

- **Run isolation:** each Q&A request runs its own LangGraph.js invocation scoped by `runId`; multiple officers can query concurrently — Express's async request handling plus per-request state (no shared mutable graph state) makes this safe by construction. No locking/queue needed at Phase 1/2 scale.
- **Parallel nodes within a run:** none in Phase 1/2 — the pipeline is intentionally sequential per question, since each step depends on the previous step's output (plan needs classify, code needs plan, execution needs code, etc.). Parallelism is not needed at the target scale (single-question latency budget, not throughput-under-load).
- **Checkpointing:** none in Phase 1/2 (no `MemorySaver`/`SqliteSaver` — runs are short-lived, single-invocation, and not resumed mid-graph). Revisit if a future phase adds long-running multi-turn plans that must survive a server restart mid-run.

---

## Graph Assembly (`src/agent/graph.js`)

```javascript
import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import {
  loadContext, classify, plan, generateCode, executeCode,
  inspectResult, synthesizeAnswer, suggestFollowups,
  handleError, finalize,
} from "./nodes/index.js";

function buildGraph() {
  const g = new StateGraph(AgentState);

  g.addNode("load_context", loadContext);
  g.addNode("classify", classify);
  g.addNode("plan", plan);
  g.addNode("generate_code", generateCode);
  g.addNode("execute_code", executeCode);
  g.addNode("inspect_result", inspectResult);
  g.addNode("synthesize_answer", synthesizeAnswer);
  g.addNode("suggest_followups", suggestFollowups);
  g.addNode("handle_error", handleError);
  g.addNode("finalize", finalize);

  g.setEntryPoint("load_context");

  g.addConditionalEdges("load_context", (s) =>
    s.error ? "handle_error" : "classify");

  g.addConditionalEdges("classify", (s) => {
    if (s.error) return "handle_error";
    if (s.complexity === "needs_clarification") return "finalize";
    if (s.complexity === "complex") return "plan";
    return "generate_code";
  });

  g.addEdge("plan", "generate_code");
  g.addEdge("generate_code", "execute_code");
  g.addEdge("execute_code", "inspect_result");

  g.addConditionalEdges("inspect_result", (s) => {
    if (s.inspectionVerdict === "retry" && s.retryCount < MAX_CODE_RETRIES) {
      return "generate_code";
    }
    return "synthesize_answer";
  });

  g.addEdge("synthesize_answer", "suggest_followups");
  g.addEdge("suggest_followups", "finalize");
  g.addEdge("finalize", END);
  g.addEdge("handle_error", END);

  return g.compile();
}

export const agentGraph = buildGraph();
```
