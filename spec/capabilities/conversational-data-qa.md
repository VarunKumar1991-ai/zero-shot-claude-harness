# Capability: Conversational Data Q&A

## What It Does
A logged-in officer asks natural-language questions about an uploaded dataset and receives a plain-language answer with the key number(s), produced by real pandas code that the system generates and executes over the real uploaded data — with the code and any failed attempts visible on expand — and can ask follow-up questions in the same session that resolve using prior conversational context.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| question | string | Ask screen | yes |
| dataset_id | UUID | route param | yes |
| acting user | session user | auth cookie | yes |
| conversation history | last N `QueryRun`s for (user, dataset) | loaded server-side by `load_context` | n/a (system-provided) |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| `QueryRun` (final_answer, key_numbers, assumptions, status) | DB row | `query_runs` table, polled by the Ask screen |
| `QueryAttempt`(s) (code, stdout, result, error per try) | DB rows | `query_attempts` table, rendered in the "Show code" panel and the Audit Log |
| progress updates | `current_node` field, polled | Ask screen's real step-counter |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Gemini API | classify/assess, plan (complex only), generate code, synthesize answer | wrapped with retry+backoff; exhausted → `QueryRun(status="failed")` with a human-readable error, never a raw stack trace |
| `src/sandbox/executor.py` | run the generated `analyze(df)` in an isolated, timeboxed subprocess | non-fatal — triggers the internal retry loop (`spec/agent.md`) |
| `DataSource` (`LocalParquetDataSource`) | load the real dataset for context and for execution | fatal if unreadable → `QueryRun(status="failed")` |

LLM calls receive **only** schema/stats, ≤5 redacted sample rows, distinct-value lists for low-cardinality columns, and aggregated/computed execution results — never the full raw dataset (see `spec/agent.md` → `load_context`, `execute_code`).

## Business Rules
- Simple counts/filters skip planning and answer in one fast pass; complex multi-step questions get an explicit plan first (`spec/agent.md`).
- Below a confidence threshold, the agent asks a clarifying question instead of guessing; if it proceeds anyway (confidence acceptable but some ambiguity remains, or retries were exhausted), every assumption made is explicitly flagged in the answer, never silently.
- Code execution retries internally with a different approach on failure, up to `AGENT_MAX_CODE_RETRIES` (default 3) attempts, before giving its best-guess answer with assumptions flagged.
- Every code execution is sandboxed: no filesystem, network, or process access beyond the in-memory DataFrame; bounded execution time (`AGENT_SANDBOX_TIMEOUT_SECONDS`, default 20s).
- The last `AGENT_CONVERSATION_HISTORY_TURNS` (default 5) question/answer pairs for the same user+dataset are included as context so follow-up questions resolve correctly without re-stating the dataset.
- Answers never state a number that wasn't actually produced by executed code.

## Success Criteria
- [ ] "How many thefts were reported in June?" against a real, sizeable (500+ row) uploaded FIR CSV returns the correct count, matching a value pre-computed independently from the same fixture (not a value a small sample would also produce — the fixture is deliberately larger than any plausible truncation point).
- [ ] The code shown on expand is the exact code that executed (verified by comparing the API's `attempts[].generated_code` to what the sandbox actually ran).
- [ ] A deliberately ambiguous question (e.g. "how many cases?" against a dataset with both FIR and conviction concepts) returns `status="needs_clarification"` with a specific clarifying question, not a guess.
- [ ] A follow-up question in the same session ("what about July?") is answered correctly using conversational context, verified against the same fixture.
- [ ] A question engineered to fail code generation on the first two attempts still returns a best-guess `final_answer` with a non-empty `assumptions` list after exhausting retries, never a raw error or an infinite loop.
