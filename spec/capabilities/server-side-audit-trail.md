# Capability: Server-Side Audit Trail

## What It Does
Every login attempt, upload, and query — including the exact code executed and result produced for each retried attempt — is recorded server-side with timestamps and the acting user, and is viewable for scrutiny, surviving a server restart.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| system-generated events | login/logout, upload, query run + each attempt | produced internally by the auth, upload, and Q&A capabilities | n/a |
| filter params (user, dataset, date range) | query params | Audit Log screen | no |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| paginated audit list | JSON | `GET /audit` |
| full query-run detail (all attempts) | JSON | `GET /audit/{query_run_id}` |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | write `AuthEvent`/`QueryRun`/`QueryAttempt` rows; read for listing/detail | a write failure here is treated as fatal to the triggering action (e.g. a query run whose audit record fails to persist is surfaced as `status="failed"`, since an unrecorded query would violate the audit requirement) |

## Business Rules
- Audit records are append-only from the application's perspective — no update/delete endpoint is exposed for `AuthEvent`, `QueryRun`, or `QueryAttempt`.
- A failed or errored query is still fully recorded (`status="failed"`, whatever code/error was produced) — failures are never dropped from the trail.
- Every record carries the acting `user_id`, timestamps (`started_at`/`completed_at` or `created_at`), and for queries: `dataset_id`, `question`, every `QueryAttempt` (code, stdout, result, error), and the final answer or error.
- Phase 1 has no role-restricted audit access — any authenticated user can view the full audit log (matches Phase 1's no-data-isolation scope).

## Success Criteria
- [ ] A successful login, a failed login, and a logout all appear in `GET /audit` with the correct `user`/`username_attempted` and timestamp.
- [ ] A completed query's exact executed code and final answer are retrievable via `GET /audit/{query_run_id}`.
- [ ] A query that failed after exhausting all retries still has a complete audit record showing every attempt's code and error (not just the last one).
- [ ] Audit entries created before a server restart are still present and correctly ordered after restart (persisted in SQLite, not memory).
