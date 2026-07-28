/**
 * Shared fetch wrapper for the API envelope used across this app:
 *   success -> { data: T, error: null }
 *   failure -> HTTP 4xx/5xx with body { detail: { code: string, message: string } }
 *
 * All calls go to the FastAPI backend at the SAME origin/port as the static
 * frontend (FastAPI mounts the Next.js static export at /app and serves the
 * API at the root — e.g. /auth/login, /datasets, /audit). Because Next.js's
 * `basePath` only rewrites internal routing/asset links, NOT raw `fetch()`
 * calls, API paths here are written root-relative (no `/app` prefix) and
 * resolve correctly against the single origin in both `next dev` (with a
 * dev proxy/same host) and the production static-export-behind-FastAPI setup.
 *
 * `credentials: 'include'` is set on every call so the httpOnly `sid` session
 * cookie is sent/received.
 */

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type Envelope<T> = { data: T; error: null }
type ErrorEnvelope = { detail?: { code?: string; message?: string } }

/** Shared envelope-parsing: read the JSON body and either return `data` or throw ApiError. */
async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const err = (body as ErrorEnvelope) ?? {}
    throw new ApiError(
      err.detail?.message ?? `Request failed (${res.status})`,
      res.status,
      err.detail?.code
    )
  }

  return (body as Envelope<T>).data
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })
  } catch {
    throw new ApiError('Couldn’t reach the server — is it running?', 0)
  }

  return parseEnvelope<T>(res)
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * Multipart upload helper — used for file uploads (e.g. `POST /datasets/upload`)
 * where the body must be a `FormData` instance, not JSON. Deliberately does NOT
 * set a `Content-Type` header: the browser sets `multipart/form-data` with the
 * correct boundary automatically when the fetch `body` is a `FormData`. Reuses
 * the same envelope-parsing/error-handling logic as `apiGet`/`apiPost`.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
  } catch {
    throw new ApiError('Couldn’t reach the server — is it running?', 0)
  }

  return parseEnvelope<T>(res)
}
