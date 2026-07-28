# Capability: Audit Trail

## What It Does
Records a full server-side log of every query run against every dataset — who ran it, what code executed, what result was produced, and when — for compliance and traceability during investigations.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| runId, userId, datasetId | identifiers | Agent graph state, populated at `load_context` | yes |
| question, generatedCode, executionResult, answer | captured pipeline data | Agent graph state, populated through the run | yes |
| status, error | outcome | `finalize` / `handle_error` nodes | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| Audit row | `queries` table row: `{id, userId, datasetId, question, generatedCode, attempts (JSON), result (JSON), answer, status, error, tokenUsage, createdAt, completedAt}` | SQLite |
| Query history | list of past audit rows for a dataset | `GET /api/datasets/:id/queries` response, history view |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | Insert/update `queries` row at run completion (success or failure) | Logged via `pino`; does not block the officer receiving their answer (see `agent.md` → Partial failure) |

## Business Rules
- An audit row is written for every run, including failed ones (not just successful answers) — a failed run still records who attempted what and why it failed.
- The full generated code (final attempt and all retry attempts) is persisted, not just the last one, so a reviewer can see what was tried.
- Audit rows are never deleted or edited by end users — read-only from the application's perspective (no `DELETE`/`PATCH` route exists for `queries`).
- Timestamps (`createdAt`, `completedAt`) are stored in UTC.

## Success Criteria
- [ ] After a successful query, the `queries` table contains a row with the correct `userId`, `question`, `generatedCode`, `result`, `answer`, and both timestamps.
- [ ] After a query that exhausts its retries and fails, a `queries` row with `status=failed` and a populated `error` field still exists.
- [ ] The query-history endpoint returns rows in reverse-chronological order for a given dataset.
- [ ] No endpoint exists that allows deleting or editing a past audit row.
