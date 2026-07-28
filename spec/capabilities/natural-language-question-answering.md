# Capability: Natural-Language Question Answering

## What It Does
Lets an officer ask a natural-language question about an uploaded dataset and receive a correct plain-language answer with key numbers, computed by real LLM-generated code executed against the full dataset (never a sample or fabricated figure), with the executed code visible on request.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| question | string | Q&A panel input | yes |
| datasetId | string (uuid) | URL/route param | yes |
| conversationHistory (Phase 2) | array of `{question, answer}` | Session's prior turns on this dataset | no |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| Answer | `{ answer: string, keyNumbers: [{label,value}], assumptions: string[] }` | Q&A panel, default collapsed view |
| Code trace | `{ generatedCode: string, attempts: [{code, executionResult, inspection}] }` | "Show code" expand panel |
| Clarifying question (when ambiguous) | `{ clarifyingQuestion: string }` | Q&A panel, in place of an answer |
| Token/cost usage | `{ promptTokens, completionTokens }` | Small badge near the answer |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Gemini API (`@google/generative-ai`) | classify / plan / generate_code / inspect_result / synthesize_answer | Retried 3x with backoff; exhausted → plain-language "analysis service unavailable" message, audit row marked failed |
| Sandbox worker (`worker_threads`) | Execute generated JS against full parsed dataset | Captured as a failed attempt, triggers internal retry (bounded), never crashes the server process |
| SQLite | Persist the query, generated code, result, answer as an audit row | Logged; does not block returning the already-computed answer to the officer |

## Business Rules
- The full dataset is analyzed by real code execution — never a truncated sample used as if it were the complete answer (see `agent.md` sandbox contract: `rows` in the sandbox is the complete parsed file).
- Only schema, a small sample (≤20 rows), and computed/aggregated results are ever sent to the LLM in a prompt — raw full-dataset rows are never included in an LLM prompt, per the data-residency constraint.
- When the agent is not confident it understood the question, it asks a clarifying question rather than guessing; if it proceeds anyway (after exhausting retries or on a judged-good-enough answer), it clearly flags its assumptions in the response.
- On code-execution failure or an implausible result, the agent retries internally (up to 2 additional attempts) with a revised approach before surfacing a best-guess-with-caveats answer.
- Simple questions (single count/filter) skip the planning step and answer in one fast pass; complex questions (multi-condition, comparative) get an explicit plan first.

## Success Criteria
- [ ] "How many thefts were reported in June?" against a real uploaded CSV returns the exact correct count, verifiable by manual inspection of the file.
- [ ] The same question against a CSV with >10,000 rows returns a count that differs from what a 20-row-sample-based answer would produce, proving full-data execution (not sampling) — see the Phase 1 gate fixture.
- [ ] Expanding "Show code" reveals the exact JS that ran, matching what's stored in the audit log.
- [ ] An ambiguous question ("how many bad cases") triggers a clarifying question instead of a guessed answer.
- [ ] A deliberately malformed/failing first code attempt is retried internally and either recovers with a correct answer or surfaces a clearly-flagged best-guess — never a raw stack trace to the officer.

## Coverage Note
Per `harness/patterns/test-driven.md`'s data-processing gate rule, the Phase 1 gate test dataset must exceed any plausible sampling truncation size (thousands of rows, not a handful), with a pre-computed known-correct answer, so a sampled implementation would visibly fail this gate.
