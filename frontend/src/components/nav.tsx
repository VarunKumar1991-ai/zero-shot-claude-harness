'use client'

/**
 * Top-nav shell for authenticated screens. Render inside an <AuthGuard> so
 * `useCurrentUser()` resolves — see `frontend/src/components/auth-guard.tsx`.
 *
 * `activeDatasetId` is optional: pass the currently-open dataset id so the
 * "Ask" link can point at `/datasets/{id}/ask`. Until a dataset is selected
 * (e.g. on the Datasets list screen) the "Ask" link is disabled/greyed with
 * a tooltip, never a broken link.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '@/components/auth-guard'
import { logout } from '@/lib/auth'

export function Nav({ activeDatasetId }: { activeDatasetId?: string }) {
  const user = useCurrentUser()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } catch {
      // Even if the server-side revoke fails, still send the user to /login —
      // the client no longer treats the session as valid either way.
    } finally {
      router.replace('/login')
    }
  }

  return (
    <nav className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold tracking-tight">UP Police Data Analyst</span>
        <Link
          href="/datasets"
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Datasets
        </Link>
        {activeDatasetId ? (
          <Link
            href={`/datasets/${activeDatasetId}/ask`}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Ask
          </Link>
        ) : (
          <span
            className="text-sm font-medium text-gray-300"
            title="Select a dataset first"
          >
            Ask
          </span>
        )}
        <Link href="/audit" className="text-sm font-medium text-gray-600 hover:text-gray-900">
          Audit Log
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <span className="text-sm text-gray-500">{user.full_name}</span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </nav>
  )
}
