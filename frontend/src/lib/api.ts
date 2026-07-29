/**
 * Thin fetch wrapper for the `{ data, error }` envelope used by every
 * `/api/*` route (see spec/api.md). Every authenticated call rides on the
 * httpOnly `session` cookie, so `credentials: 'include'` is set on every
 * request.
 *
 * A 401 is surfaced as a plain `ApiError` with `status === 401` — it is
 * NOT automatically treated as "session expired", because `POST
 * /api/auth/login` itself returns 401 for wrong credentials (a completely
 * different, expected case, per spec/api.md). Callers on already-
 * authenticated routes (dataset list/profile/queries, `/auth/me`) should
 * check `isSessionExpired(err)` and route back to /login with a notice;
 * the login page instead renders its own "Incorrect username or password"
 * copy for the same status code.
 */

// The backend's actual error shape is `{ code, message }` (every route in
// src/routes/*.js follows this consistently), not the bare string implied
// by spec/api.md's abbreviated example — this type matches the real,
// running contract.
type EnvelopeError = { code?: string; message: string } | string

export type ApiEnvelope<T> = {
  data: T | null
  error: EnvelopeError | null
}

function errorMessage(error: EnvelopeError | null | undefined, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  return error.message ?? fallback
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** True when `err` represents an expired/invalid session on an
 * already-authenticated request (never call this for the login endpoint
 * itself — a 401 there means wrong credentials, not an expired session). */
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null
  try {
    body = (await res.json()) as ApiEnvelope<T>
  } catch {
    // Non-JSON response (e.g. an unmounted route's default HTML 404 page) —
    // fall through to a status-based message.
  }

  if (!res.ok) {
    throw new ApiError(errorMessage(body?.error, `Request failed (${res.status})`), res.status)
  }

  if (!body || body.error) {
    throw new ApiError(errorMessage(body?.error, 'Unexpected server response'), res.status)
  }

  return body.data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { credentials: 'include' })
  } catch {
    throw new Error('Network error — is the server running?')
  }
  return parseEnvelope<T>(res)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Network error — is the server running?')
  }
  return parseEnvelope<T>(res)
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
  } catch {
    throw new Error('Network error — is the server running?')
  }
  return parseEnvelope<T>(res)
}

export type CurrentUser = {
  id: string
  username: string
  displayName: string
}
