# Agent

This project uses LangGraph — this file is REQUIRED and binding on the implementation.

---

## Agent Architecture Pattern

**Chosen: Graph (LangGraph)**, composing several `harness/patterns/agentic-ai.md` patterns:

- **Tool Use / LLM-Generated Code Execution (#5, #22)** — the core mechanism: Gemini writes pandas code, the system executes it for real against the real uploaded data. This is the anti-hardcoded-op-list pattern the catalogue mandates for "arbitrary, open-ended questions about data."
- **Planning (#6)** — complex, multi-step questions get an explicit plan before code generation; simple counts/filters skip it for speed.
- **Reflection (#4)** — `inspect_result` critiques the executed result and can send the loop back to `generate_code` with the failure reason, up to a bounded retry count, "trying a different approach" per the brief.
- **Reasoning Techniques (#17)** — ReAct-shaped loop: reason (classify/plan) → act (generate + execute code) → observe (inspect) → repeat.
- **Guardrails (#18)** — the data-minimization constraint ("never send raw rows to the LLM where avoidable") is enforced structurally in `load_context` and in `execute_code`'s result-capping, not just by prompt instruction.
- **Exception Handling and Recovery (#12)** — every external call (Gemini, sandbox subprocess) is wrapped; failures route to `handle_error`, which still finalizes an audit record rather than crashing.
- **Memory Management (#8)** — short-term: full `AgentState` within a run. Cross-turn: the last N `QueryRun`s for a (user, dataset) pair are loaded as conversation history so follow-up questions resolve correctly.

Rationale: this is not a single deterministic transform (the base skeleton's `transform_text`) — it is exactly the class of task the catalogue says warrants at least a ReAct loop, extended with planning and reflection because the brief explicitly requires "plan a strategy for complex questions," "retry internally with a different approach," and "prefer a clarifying question, else flag assumptions."

---

## LLM Provider & Model

Provider: **Google Gemini**, via the existing `src/llm/` abstraction (`AGENT_GEMINI_API_KEY`, auto-detected — no code change needed for provider selection).

| Agent / Node | Provider | Model ID | Rationale |
|-------------|----------|----------|-----------|
| `classify_and_assess` | Gemini | `gemini-2.5-flash` (env: `AGENT_LLM_FAST_MODEL`) | Cheap, low-latency triage call on every question; quality of a full model is not needed to classify simple-vs-complex or flag ambiguity |
| `plan_analysis` | Gemini | `gemini-3.1-pro` (env: `AGENT_LLM_MODEL`) | Multi-step plans benefit from stronger reasoning |
| `generate_code` | Gemini | `gemini-3.1-pro` | Code correctness matters most here — this is the node whose output is actually executed |
| `inspect_result` (optional LLM check) | Gemini | `gemini-2.5-flash` | Cheap sanity check of result-vs-intent; deterministic checks run first and are preferred |
| `synthesize_answer` | Gemini | `gemini-3.1-pro` | User-facing prose quality and correct handling of flagged assumptions |
| `suggest_followups` (Phase 3; stub in Phase 1) | Gemini | `gemini-2.5-flash` | Low-stakes, cheap suggestions |

> **Assumed:** a new `AGENT_LLM_FAST_MODEL` setting (default `gemini-2.5-flash`) is added to `src/config/settings.py` alongside the existing `llm_model`/`AGENT_LLM_MODEL`. `LLMClient.call_model(prompt, system=..., model=...)` gains an optional `model` override parameter (defaulting to `settings.llm_model`) so a single client can serve both the fast and quality models without a second provider instantiation per call.

**Fallback behaviour:** each Gemini call is wrapped with 2 retries (exponential backoff, starting at 1s) for transient errors (429/5xx/timeout). On final exhaustion the node sets `state["error"]` with a human-readable message; the graph routes to `handle_error`, which still writes a `QueryRun` audit record with `status="failed"` — the user sees "The analysis service is temporarily unavailable — please try again" rather than a stack trace or a silent hang.

**Prompt strategy:** system/user split via the existing `src/prompts/*.md` templates (one file per node, loaded at runtime, replacing `transform.md`). `classify_and_assess` and `generate_code` request structured JSON output (validated with a Pydantic model on receipt — malformed JSON is treated as a node-level error, retried once, then falls back to a safe default: `complexity="complex"`, `needs_clarification=false`, i.e. proceed rather than block). `generate_code` is few-shot: the prompt includes one worked example of the expected `def analyze(df): ...` shape.

---

## Tools & Tool Calling

| Tool name | Description | Inputs | Output | Side-effects |
|-----------|-------------|--------|--------|--------------|
| `load_dataset_context` | Reads profile, capped/redacted sample, annotations, conversation history via `DataSource` + SQLite | `dataset_id`, `user_id` | `schema_context`, `sample_rows`, `annotations`, `conversation_history` | DB reads only |
| `execute_sandboxed_code` | Runs generated `analyze(df)` in an isolated, timeboxed subprocess | `code: str`, `df: DataFrame` (via `DataSource.get_dataframe`) | `result: dict \| None`, `stdout: str`, `error: str \| None`, `duration_ms: int` | Spawns and terminates a subprocess; no persistent side-effect |
| `persist_query_run` | Writes the `QueryRun` + all `QueryAttempt` rows | full `AgentState` | `query_run_id` | DB write — this **is** the audit trail |

**Tool selection strategy:** deterministic — each node calls exactly the tool(s) named above; there is no LLM-driven tool-choice step (the graph topology *is* the plan, aside from the `plan_analysis` node's free-text step list, which is descriptive context for `generate_code`, not a tool dispatcher).

**Tool failure handling:** `execute_sandboxed_code` failures (timeout, exception, static-validation rejection) are non-fatal at the tool level — they populate `execution_error` and route to `inspect_result`, which decides retry vs. proceed-with-best-guess. `persist_query_run` failures (DB write error) are fatal — logged and surfaced as a 500, since an unrecorded query run would violate the audit-trail requirement.

---

## Agent State

```python
class AgentState(TypedDict, total=False):
    # Identity
    query_run_id: str
    user_id: str
    dataset_id: str

    # Input
    question: str
    conversation_history: list[dict]     # [{"question": str, "answer": str}, ...] last N turns, loaded by load_context

    # Context (populated by load_context — the only node touching raw data directly)
    schema_context: dict                 # {columns: [{name, dtype, null_count, distinct_count, min, max}], row_count, date_range}
    sample_rows: list[dict]              # <=5 rows, free-text/narrative columns redacted
    annotations: dict[str, str]          # column_name -> business-rule note (empty {} until Phase 2)

    # Classification
    complexity: str                      # "simple" | "complex"
    needs_clarification: bool
    clarifying_question: str | None

    # Planning (complex questions only)
    plan: list[str] | None

    # Code generation / execution loop
    current_code: str | None
    attempts: list[dict]                 # [{attempt_number, code, stdout, result, error, duration_ms}], full history for audit + expand-view
    retry_count: int
    max_retries: int                     # from AGENT_MAX_CODE_RETRIES, default 3
    execution_result: dict | None
    execution_error: str | None

    # Output
    final_answer: str | None
    key_numbers: dict | None
    assumptions: list[str]               # flagged whenever the agent guessed rather than clarified
    followups: list[str]                 # [] in Phase 1 (stub); real from Phase 3

    # Usage
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: float

    # Control
    current_node: str                    # written after every node for progress polling
    status: str                          # "pending" | "needs_clarification" | "completed" | "failed"
    error: str | None                    # set by any node on fatal failure
```

---

## Nodes / Steps

### `load_context`

**Reads from state:** `dataset_id`, `user_id`
**Writes to state:** `schema_context`, `sample_rows`, `annotations`, `conversation_history`, `current_node`
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| `DataSource` | `profile()`, `get_dataframe(columns=...).head(5)`, `distinct_values()` for low-cardinality text columns | fatal — sets `error`, routes to `handle_error` (dataset unreadable is unrecoverable for this run) |
| SQLite | read last N `QueryRun`s for (user_id, dataset_id) | non-fatal — logs and continues with empty history |

**Behaviour:** builds every downstream node's *only* window into the data: column names/dtypes/stats, up to 5 sample rows with any free-text/narrative column value truncated to `"[redacted]"`, the distinct-value list (≤20) for low-cardinality categorical columns (so the LLM knows real vocabulary like `"Theft"` vs `"THEFT"` without seeing raw rows), any saved annotations, and up to `AGENT_CONVERSATION_HISTORY_TURNS` (default 5) prior question/answer pairs for this dataset+user.

### `classify_and_assess`

**Reads from state:** `question`, `schema_context`, `conversation_history`
**Writes to state:** `complexity`, `needs_clarification`, `clarifying_question`, `current_node`, token/cost deltas
**LLM call:** yes — `gemini-2.5-flash`, structured JSON: `{complexity, confidence, ambiguous_terms, needs_clarification, clarifying_question}`
**External calls:** Gemini API — see Fallback behaviour above.
**Behaviour:** decides simple vs. complex, and whether the question is too ambiguous to answer safely (`confidence < 0.55` **and** `ambiguous_terms` non-empty) — in which case it prefers asking rather than guessing, per the brief. Malformed/unparseable model output defaults to `complexity="complex", needs_clarification=false` (proceed, don't block).

### `plan_analysis`

**Reads from state:** `question`, `schema_context`, `conversation_history`
**Writes to state:** `plan`, `current_node`
**LLM call:** yes — `gemini-3.1-pro`, free-text 2–5 step list
**External calls:** Gemini API.
**Behaviour:** only reached when `complexity == "complex"`. Produces a short, ordered analysis strategy that `generate_code` follows; skipped entirely for simple counts/filters so those answer in one fast pass, per the brief.

### `generate_code`

**Reads from state:** `question`, `schema_context`, `sample_rows`, `annotations`, `plan`, `conversation_history`, and — on retry — the most recent failed `attempts` entry
**Writes to state:** `current_code`, appends to `attempts`, `current_node`
**LLM call:** yes — `gemini-3.1-pro`, requests a single `def analyze(df):` function returning a JSON-serializable dict
**External calls:** Gemini API.
**Behaviour:** writes pandas code using only the schema/sample/plan/annotation context — never the full dataset. On retry, the prompt explicitly includes the prior attempt's code and error and instructs the model to "try a different approach, not a minor edit," per the brief.

### `execute_code`

**Reads from state:** `current_code`, `dataset_id`
**Writes to state:** `execution_result`, `execution_error`, updates the last `attempts` entry, `current_node`
**LLM call:** no
**External calls:**

| System | Operation | On Failure |
|--------|-----------|------------|
| `src/sandbox/executor.py` | AST-validate then run `analyze(df)` in an isolated subprocess with a hard timeout | non-fatal — sets `execution_error`, routes to `inspect_result` for the retry decision |
| `DataSource.get_dataframe` | load the real dataset (or datasets, Phase 2+) into the sandboxed process | fatal if the dataset itself is unreadable — routes to `handle_error` |

**Behaviour:** the only node that runs untrusted, LLM-generated code, and the only node (besides `load_context`) that touches the real `DataFrame`. Tabular results are capped to `head(50)` with a `truncated` flag before being written back to state, so nothing downstream can leak more raw rows than the guardrail allows.

### `inspect_result`

**Reads from state:** `execution_result`, `execution_error`, `retry_count`, `max_retries`, `question`
**Writes to state:** `retry_count`, `assumptions` (when proceeding after exhausted retries), `current_node`
**LLM call:** optional — `gemini-2.5-flash`, only when deterministic checks pass but a light result-vs-intent check adds value (e.g. question implies a count but result is a list)
**External calls:** Gemini API (optional path only).
**Behaviour (Reflection, #4):** deterministic checks first — is `execution_error` set? is `execution_result` `None`/empty/all-NaN? Any failure increments `retry_count`; while `retry_count < max_retries` (default 3), routes back to `generate_code`. Once retries are exhausted (or checks pass), routes to `synthesize_answer` — if it is proceeding on a still-imperfect result, it appends a plain-language note to `assumptions` (e.g. "best guess after 3 attempts; result may be incomplete") so the answer never claims false certainty.

### `synthesize_answer`

**Reads from state:** `question`, `execution_result`, `plan`, `assumptions`, `conversation_history`
**Writes to state:** `final_answer`, `key_numbers`, `assumptions` (finalized), `current_node`, token/cost totals
**LLM call:** yes — `gemini-3.1-pro`
**External calls:** Gemini API.
**Behaviour:** turns the aggregated/computed `execution_result` (never raw rows) into a plain-language answer with explicit key numbers, and states any flagged assumptions in the answer itself (not buried) — matching the brief's "give its best guess and clearly flag assumptions."

### `suggest_followups`

**Reads from state:** `schema_context`, `final_answer`
**Writes to state:** `followups`, `current_node`
**LLM call:** Phase 1: **no** (stub — writes `followups: []`). Phase 3: yes — `gemini-2.5-flash`.
**Behaviour:** Phase 1 wires this node into the graph now (per the "agentic stack wired from day one" rule) as an inert no-op, so Phase 3 only changes this node's body, not the graph topology.

### `request_clarification`

**Reads from state:** `clarifying_question`
**Writes to state:** `status="needs_clarification"`, `current_node`
**LLM call:** no
**Behaviour:** terminal branch reached when `classify_and_assess` decided the question is too ambiguous to answer safely. No code is generated or executed on this path.

### `handle_error`

**Reads from state:** `error`
**Writes to state:** `status="failed"`, `current_node`
**Behaviour:** reached on any fatal node failure (unreadable dataset, exhausted Gemini retries, DB write failure prior to persistence). Always followed by `finalize` so a failed run is still fully audited.

### `finalize`

**Reads from state:** the full `AgentState`
**Writes to state:** persists `QueryRun` (status, question, final_answer, key_numbers, assumptions, clarifying_question, complexity, plan, token/cost totals, timestamps) and every `QueryAttempt` (code, stdout, execution_result, execution_error, duration_ms) to SQLite.
**Behaviour:** this node **is** the audit trail write path (`spec/capabilities/server-side-audit-trail.md`). Runs on every path — success, clarification, and failure — so no query is ever left unrecorded.

---

## Graph / Flow Topology

```
START
  │
  ▼
load_context ──(error)──► handle_error ──► finalize ──► END
  │
  ▼
classify_and_assess ──(error)──► handle_error ──► finalize ──► END
  │
  ├──(needs_clarification)──► request_clarification ──► finalize ──► END
  │
  ├──(complexity == "complex")──► plan_analysis ──► generate_code
  │
  └──(complexity == "simple")───────────────────────► generate_code
                                                            │
                                                            ▼
                                                       execute_code
                                                            │
                                                            ▼
                                                     inspect_result
                                     ┌──(needs_retry AND retry_count < max_retries)──┐
                                     │                                                │
                                     └────────────────────────────◄───────────────────┘  (loops to generate_code)
                                                            │
                                            (ok, or retries exhausted)
                                                            ▼
                                                    synthesize_answer
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
| `load_context` | `state["error"]` is set | `handle_error` |
| `load_context` | else | `classify_and_assess` |
| `classify_and_assess` | `state["error"]` is set | `handle_error` |
| `classify_and_assess` | `state["needs_clarification"]` is `True` | `request_clarification` |
| `classify_and_assess` | `state["complexity"] == "complex"` | `plan_analysis` |
| `classify_and_assess` | `state["complexity"] == "simple"` | `generate_code` |
| `inspect_result` | execution failed/unsatisfactory AND `retry_count < max_retries` | `generate_code` |
| `inspect_result` | else | `synthesize_answer` |
| `request_clarification` | always | `finalize` |
| `handle_error` | always | `finalize` |
| `finalize` | always | `END` |

---

## Memory & Context

| Scope | Mechanism | What is stored |
|-------|-----------|-----------------|
| **Within a run** | LangGraph state | All in-progress fields above |
| **Across runs (audit)** | SQLite (`query_runs`, `query_attempts`) | Every run's question, answer, code, and outcome — permanent, never pruned in Phase 1–3 |
| **Conversation** | SQLite (`query_runs` for the same user+dataset), loaded by `load_context` | Last `AGENT_CONVERSATION_HISTORY_TURNS` (default 5) question/answer pairs, injected into `classify_and_assess`, `plan_analysis`, and `generate_code` prompts so follow-ups resolve correctly |

**Context window management:** conversation history is capped at N turns (not summarized in Phase 1 — question/answer pairs are short); sample rows capped at 5; distinct-value lists capped at 20 per column; tabular execution results capped at `head(50)`. These caps are both a context-window control and the data-minimization guardrail.

---

## Error Handling & Recovery

**Node-level:** every node wraps its Gemini/`DataSource`/sandbox calls in try/except; a caught exception sets `state["error"]` with a human-readable message and the node still returns state (never raises past the graph boundary).

**Graph-level (`handle_error` node):**
- Reads: `state.error`, `state.query_run_id`
- Always proceeds to `finalize`, so DB status → `"failed"`, `error_message` set, `completed_at` stamped — a failed run is not an unaudited run.
- Logs the error with `query_run_id`, `user_id`, `dataset_id` context via `structlog`.

**Resume / retry strategy:** the `generate_code` ⇄ `execute_code` ⇄ `inspect_result` loop is the agent's internal retry mechanism (bounded by `max_retries`); there is no cross-run resume in Phase 1 — a failed run is reported to the user, who can re-ask.

**Partial failure:** a Gemini call failure is fatal for that run (routes to `handle_error`); a single code-execution failure is *not* fatal — it triggers a bounded retry, and after retries are exhausted the agent still produces a best-guess answer with `assumptions` flagged rather than failing the whole run, per the brief.

---

## Observability

| Signal | What | Where |
|--------|------|-------|
| **Trace** | One structured log line per node transition (`node`, `query_run_id`, `duration_ms`, `status`) | stdout via `structlog` (`src/observability/events.py`, extended) |
| **LLM calls** | Node tag, model, prompt tokens, completion tokens, latency, success/error | stdout structured log + accumulated onto `QueryRun` for the per-query cost display |
| **Sandbox execution** | Attempt number, code hash, duration_ms, success/error | stdout structured log + persisted `QueryAttempt` row |
| **Run outcome** | Status, total duration, error if any | SQLite (`query_runs`) + structured log |

Wired from Phase 1 (never deferred), per `harness/rules/ai-agents.md`. LangSmith tracing is optional and auto-enables only if `LANGCHAIN_API_KEY`/`LANGCHAIN_TRACING_V2=true` are present in `.env` (not required — structured stdout logging is the baseline that is always on).

---

## Concurrency Model

- **Run isolation:** each `POST /datasets/{id}/query` creates its own `QueryRun` row and runs the graph as an independent FastAPI `BackgroundTasks` task; multiple officers can have in-flight queries concurrently, each scoped by its own `query_run_id`.
- **Parallel nodes within a run:** none in Phase 1 (the loop is inherently sequential — plan depends on classification, code depends on plan, execution depends on code). No parallelization opportunity to exploit at this stage.
- **Sandbox isolation:** every `execute_code` call spawns its own subprocess — concurrent queries never share a Python interpreter or namespace for code execution.
- **Checkpointing:** none (no LangGraph checkpointer) — a run either completes (success, clarification, or failure) or the process crashes, in which case the `QueryRun` remains `pending` and is surfaced to the user as stalled/retryable; no mid-graph resume in Phase 1–3.
- **SQLite concurrency:** WAL mode enabled (`PRAGMA journal_mode=WAL`) so concurrent reads (progress polling, audit browsing) don't block concurrent writes (finalize) at Phase 1–3's expected scale.

---

## Graph Assembly (`src/graph/agent.py`)

```python
from langgraph.graph import StateGraph, END

from graph.state import AgentState
from graph.nodes import (
    load_context, classify_and_assess, plan_analysis, generate_code,
    execute_code, inspect_result, synthesize_answer, suggest_followups,
    request_clarification, handle_error, finalize,
)
from graph.edges import (
    after_load_context, after_classify, after_inspect_result,
)


def _build_graph() -> StateGraph:
    g = StateGraph(AgentState)
    for name, fn in [
        ("load_context", load_context),
        ("classify_and_assess", classify_and_assess),
        ("plan_analysis", plan_analysis),
        ("generate_code", generate_code),
        ("execute_code", execute_code),
        ("inspect_result", inspect_result),
        ("synthesize_answer", synthesize_answer),
        ("suggest_followups", suggest_followups),
        ("request_clarification", request_clarification),
        ("handle_error", handle_error),
        ("finalize", finalize),
    ]:
        g.add_node(name, fn)

    g.set_entry_point("load_context")

    g.add_conditional_edges("load_context", after_load_context, {
        "classify_and_assess": "classify_and_assess", "handle_error": "handle_error",
    })
    g.add_conditional_edges("classify_and_assess", after_classify, {
        "plan_analysis": "plan_analysis",
        "generate_code": "generate_code",
        "request_clarification": "request_clarification",
        "handle_error": "handle_error",
    })
    g.add_edge("plan_analysis", "generate_code")
    g.add_edge("generate_code", "execute_code")
    g.add_edge("execute_code", "inspect_result")
    g.add_conditional_edges("inspect_result", after_inspect_result, {
        "generate_code": "generate_code", "synthesize_answer": "synthesize_answer",
    })
    g.add_edge("synthesize_answer", "suggest_followups")
    g.add_edge("suggest_followups", "finalize")
    g.add_edge("request_clarification", "finalize")
    g.add_edge("handle_error", "finalize")
    g.add_edge("finalize", END)

    return g.compile()


agentic_ai = _build_graph()
```

The runner (`src/graph/runner.py`) uses `agentic_ai.stream(initial_state, stream_mode="values")` rather than `.invoke()`, persisting `current_node`/`status` after each yielded step so `GET /datasets/{id}/queries/{query_id}` reflects real progress, not a fake spinner.
