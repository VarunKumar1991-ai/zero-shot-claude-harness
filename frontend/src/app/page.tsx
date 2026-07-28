'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { fetchCurrentUser } from '@/lib/auth'

/**
 * Root route: no content of its own — resolves the session and redirects to
 * either /datasets (authenticated) or /login (not authenticated).
 */
export default function Home() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    fetchCurrentUser()
      .then(user => {
        if (cancelled) return
        router.replace(user ? '/datasets' : '/login')
      })
      .catch(() => {
        if (cancelled) return
        router.replace('/login')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-gray-400">
      Loading…
    </main>
  )
}
