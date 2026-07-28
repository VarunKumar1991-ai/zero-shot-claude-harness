# Capability: Exportable Report

> **Deferred to Phase 3** (`spec/roadmap.md`). Phase 1–2 ship a labelled, disabled "Export" button.

## What It Does
Produces a downloadable file/report of a query's findings — question, plain-language answer, key numbers, chart (if any), and the executed code — for offline sharing or filing.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| query_run_id | UUID | Ask screen "Export" action | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| exported file (PDF and/or CSV bundle) | file download | browser |

## External Calls
None beyond reading the already-persisted `QueryRun`/`QueryAttempt` rows.

## Business Rules
- The export reflects exactly what was shown on screen — no re-computation, no additional LLM call.
- Export is available for any `status="completed"` query run; not offered for `pending`/`needs_clarification`/`failed` runs.

## Success Criteria
- [ ] Clicking Export on a completed query produces a downloadable file containing the question, answer, key numbers, and executed code, matching what's on screen.
