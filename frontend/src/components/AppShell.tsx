'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { apiGet, apiPost, type CurrentUser } from '@/lib/api'

/**
 * Authenticated app shell: header/nav + logout. Rendered around every page
 * from the root layout. The login page (and root redirect page) opt out of
 * the nav bar since there's no session to show yet.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checked, setChecked] = useState(false)

  const isAuthSurface = pathname === '/login' || pathname === '/'

  useEffect(() => {
    let cancelled = false
    apiGet<CurrentUser>('/auth/me')
      .then(u => {
        if (!cancelled) setUser(u)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  async function handleLogout() {
    try {
      await apiPost('/auth/logout')
    } catch {
      // Best-effort: even if the request fails, drop the client to /login.
    }
    setUser(null)
    router.push('/login')
  }

  if (isAuthSurface) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/datasets" className="text-base font-semibold tracking-tight text-gray-900">
            UP Police Data Analyst
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/datasets" className="text-gray-600 hover:text-gray-900">
              Datasets
            </Link>
            {checked && user && (
              <>
                <span className="text-gray-400">{user.displayName || user.username}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
                >
                  Log out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
