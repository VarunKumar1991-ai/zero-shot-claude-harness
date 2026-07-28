import { apiGet, apiPost, ApiError } from './api'

export type CurrentUser = {
  user_id: string
  username: string
  full_name: string
  role: string
}

/** GET /auth/me — resolves to the logged-in user, or null if unauthenticated. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await apiGet<CurrentUser>('/auth/me')
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

/** POST /auth/logout — revokes the session server-side. */
export function logout(): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>('/auth/logout')
}
