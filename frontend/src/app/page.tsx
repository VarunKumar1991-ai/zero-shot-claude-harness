'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, type CurrentUser } from '@/lib/api'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    apiGet<CurrentUser>('/auth/me')
      .then(() => {
        if (!cancelled) router.replace('/datasets')
      })
      .catch(() => {
        if (!cancelled) router.replace('/login')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
          aria-hidden="true"
        />
        <p className="text-sm">Loading…</p>
      </div>
    </main>
  )
}
