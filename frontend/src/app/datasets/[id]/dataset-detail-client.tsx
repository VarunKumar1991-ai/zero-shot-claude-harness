'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { apiGet, ApiError } from '@/lib/api'
import { ProfilePanel, type DatasetProfile } from '@/components/profile-panel'

type DatasetDetail = {
  dataset_id: string
  name: string
  status: string
  profile: DatasetProfile
  uploaded_by: string
  created_at: string
  updated_at: string
}

function DatasetDetailInner({ datasetId }: { datasetId: string }) {
  const [dataset, setDataset] = useState<DatasetDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<DatasetDetail>(`/datasets/${datasetId}`)
      .then(data => {
        if (cancelled) return
        setDataset(data)
      })
      .catch(err => {
        if (cancelled) return
        setError(
          err instanceof ApiError && err.status === 404
            ? 'Dataset not found — it may have been removed.'
            : err instanceof ApiError
              ? err.message
              : 'Couldn’t reach the server — is it running?'
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {loading && (
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-gray-200" />
          <div className="h-32 w-full rounded bg-gray-200" />
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && dataset && (
        <ProfilePanel
          profile={dataset.profile}
          datasetId={dataset.dataset_id}
          datasetName={dataset.name}
        />
      )}
    </main>
  )
}

export function DatasetDetailClient() {
  const params = useParams<{ id: string }>()
  const id = params.id

  return (
    <AuthGuard>
      <Nav activeDatasetId={id} />
      <DatasetDetailInner datasetId={id} />
    </AuthGuard>
  )
}
