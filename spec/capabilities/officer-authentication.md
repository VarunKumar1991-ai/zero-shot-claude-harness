# Capability: Officer Authentication

## What It Does
Officers and analysts log in with a per-officer username/password, establishing a server-side session used to attribute every subsequent upload and query to a named user.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| username | string | login form | yes |
| password | string | login form | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| session cookie (`sid`) | httpOnly cookie | browser, used on every subsequent request |
| user profile | JSON (`user_id`, `username`, `full_name`, `role`) | login response, cached client-side for the nav/route guard |
| `AuthEvent` record | DB row | `auth_events` table (audit trail) |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | look up `User` by username, verify bcrypt hash, create `Session` row | invalid credentials → 401 with a generic message; DB error → 500 |

## Business Rules
- Passwords are stored as bcrypt hashes only — never plaintext, never logged.
- A failed login is recorded (`AuthEvent(event_type="login_failure")`) without revealing whether the username exists — the response message is identical for "unknown user" and "wrong password".
- Sessions are server-side and revocable (not stateless JWTs), expire after `AGENT_SESSION_TTL_HOURS` (default 12h), and are stored as httpOnly, SameSite=Lax cookies.
- No self-service registration in Phase 1 — accounts are provisioned via a seed/admin script (`spec/data.md` → User, `Assumed`).
- All logged-in users can see all uploaded datasets in Phase 1 — no per-user/role data isolation yet (explicit brief scope).
- Every dataset upload and query run records the acting `user_id` — authentication exists specifically to make attribution possible, not to restrict access in Phase 1.

## Success Criteria
- [ ] Logging in with valid credentials returns 200, sets the session cookie, and `GET /auth/me` subsequently returns the correct user.
- [ ] Logging in with an invalid username or wrong password returns 401 with a generic message, and an `AuthEvent(login_failure)` row is created.
- [ ] Any request to a protected endpoint without a valid session cookie returns 401.
- [ ] A dataset uploaded and a query run while logged in as user A both record `user_id = A`'s id, verifiable via `GET /audit`.
- [ ] Logging out revokes the session (`revoked_at` set) and a subsequent request with the same cookie returns 401.
