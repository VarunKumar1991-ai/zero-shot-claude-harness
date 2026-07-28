'use client'

/**
 * Route guard used by every authenticated screen.
 *
 * Usage (this is the pattern all other frontend slices — datasets, ask,
 * audit — should follow):
 *
 *   import { AuthGuard } from '@/components/auth-guard'
 *   import { Nav } from '@/components/nav'
 *
 *   export default function DatasetsPage() {
 *     return (
 *       <AuthGuard>
 *         <Nav />
 *         <main>...page content...</main>
 *       </AuthGuard>
 *     )
 *   }
 *
 * `AuthGuard` calls `GET /auth/me` on mount. While that check is in flight it
 * renders a minimal loading state (no flash of protected content). If the
 * session is invalid/expired, it redirects to `/login`. If valid, it renders
 * `children` and also exposes the resolved user via the `useCurrentUser()`
 * hook for anything nested inside (e.g. `Nav` shows the user's name).
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchCurrentUser, type CurrentUser } from '@/lib/auth'

const CurrentUserContext = createContext<CurrentUser | null>(null)

/** Read the current user from inside an <AuthGuard>. Returns null until resolved. */
export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext)
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'authed' | 'redirecting'>('checking')
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCurrentUser()
      .then(u => {
        if (cancelled) return
        if (u) {
          setUser(u)
          setStatus('authed')
        } else {
          setStatus('redirecting')
          router.replace('/login')
        }
      })
      .catch(() => {
        if (cancelled) return
        setStatus('redirecting')
        router.replace('/login')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  if (status !== 'authed') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
        Checking session…
      </div>
    )
  }

  return (
    <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
  )
}
