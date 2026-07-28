# Capability: Officer Authentication

## What It Does
Lets an officer log in with a local username/password so every subsequent upload and query can be attributed to them in the audit trail.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| username | string | Login form | yes |
| password | string | Login form | yes |
| session cookie | JWT (httpOnly cookie) | Subsequent requests | yes (after login) |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| Session cookie | httpOnly JWT cookie | Browser, set on successful login |
| Current-user profile | `{ id, username }` | `GET /api/auth/me` response, frontend header |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite `users` table | Look up username, verify bcrypt hash | Invalid credentials → 401 with a plain "incorrect username or password" message; DB error → 500, logged |

## Business Rules
- Passwords are hashed with bcrypt (cost factor 12); plaintext passwords are never stored or logged.
- Sessions are JWT-based, httpOnly cookie, 12-hour expiry; expired/invalid tokens force re-login.
- All logged-in users see all uploaded datasets in Phase 1 and Phase 2 — no per-user data isolation (explicit out-of-scope item).
- No self-service registration in Phase 1 — accounts are seeded via `npm run migrate` (which also seeds one test officer account and prints its credentials).

## Success Criteria
- [ ] A seeded officer can log in with correct credentials and receive a valid session cookie.
- [ ] An incorrect password is rejected with a 401 and a plain-language error, never a stack trace.
- [ ] An unauthenticated request to any dataset/query endpoint is rejected with a 401.
- [ ] Every dataset upload and query is recorded with the acting officer's `userId`.
