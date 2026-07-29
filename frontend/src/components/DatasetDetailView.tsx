'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiGet, ApiError, isSessionExpired } from '@/lib/api'
import type { DatasetProfile } from '@/lib/types'
import ProfileCard from '@/components/ProfileCard'
import QAPanel from '@/components/QAPanel'
import ChartsStub from '@/components/stubs/ChartsStub'
import ExportStub from '@/components/stubs/ExportStub'

type LoadState = 'loading' | 'error' | 'ready'

/** Reads the real dataset id from the live browser URL rather than the
 * statically-baked `params` prop — see the comment in
 * `app/datasets/[id]/page.tsx` for why this is necessary for a static
 * export with a genuinely dynamic (not build-time-known) id segment. */
function useDatasetIdFromPath(): string | null {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const datasetsIndex = segments.indexOf('datasets')
  if (datasetsIndex === -1 || !segments[datasetsIndex + 1]) return null
  return decodeURIComponent(segments[datasetsIndex + 1])
}

export default function DatasetDetailView() {
  const id = useDatasetIdFromPath()
  const router = useRouter()
  const [profile, setProfile] = useState<DatasetProfile | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)

  const handleSessionExpired = useCallback(() => {
    router.push('/login?expired=1')
  }, [router])

  const loadProfile = useCallback(() => {
    if (!id) return
    setState('loading')
    setError(null)
    apiGet<DatasetProfile>(`/datasets/${id}/profile`)
      .then(p => {
        setProfile(p)
        setState('ready')
      })
      .catch(err => {
        if (isSessionExpired(err)) {
          handleSessionExpired()
          return
        }
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Dataset not found — it may have been removed.'
            : err instanceof Error
              ? err.message
              : 'Failed to load this dataset'
        )
        setState('error')
      })
  }, [id, handleSessionExpired])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  return (
    <div className="space-y-4">
      <Link href="/datasets" className="text-sm text-blue-600 hover:text-blue-800">
        ← All datasets
      </Link>

      {!id && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          No dataset selected.
        </div>
      )}

      {id && state === 'loading' && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-32 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-96 animate-pulse rounded-lg bg-gray-100" />
        </div>
      )}

      {id && state === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <p className="mb-3">{error}</p>
          <button
            type="button"
            onClick={loadProfile}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      )}

      {id && state === 'ready' && profile && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <ProfileCard profile={profile} />
            <ChartsStub />
            <ExportStub />
          </div>
          <div className="lg:col-span-2">
            <QAPanel datasetId={id} onSessionExpired={handleSessionExpired} />
          </div>
        </div>
      )}
    </div>
  )
}
