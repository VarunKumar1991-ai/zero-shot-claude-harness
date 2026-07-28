# Capability: Follow-Up Suggestions

> **Deferred to Phase 3** (`spec/roadmap.md`). Phase 1–2 ship the `suggest_followups` graph node as an inert stub (writes `followups: []`) and a labelled, greyed-out chip row in the UI.

## What It Does
After answering, proactively suggests 2–3 relevant follow-up questions the user can click to ask immediately.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| schema_context, final_answer | from the completed `QueryRun` | `suggest_followups` graph node | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| `followups` (2–3 question strings) | JSON on `QueryRun` | Ask screen chip row |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Gemini API (`gemini-2.5-flash`) | generate follow-up questions grounded in schema + answer | non-fatal — `followups: []`, the primary answer is unaffected |

## Business Rules
- Suggestions must be answerable against the same dataset (grounded in `schema_context`, not generic).
- A follow-up-suggestion failure never blocks or delays the primary answer being shown.

## Success Criteria
- [ ] A completed query returns 2–3 non-empty, dataset-relevant follow-up suggestions.
- [ ] Clicking a suggested follow-up asks that exact question and produces a new answer.
- [ ] If the follow-up LLM call fails, the primary answer is still shown promptly with an empty suggestions row (no visible error, no delay to the main answer).
