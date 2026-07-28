'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { apiGet, ApiError } from '@/lib/api'

type DatasetListItem = {
  dataset_id: string
  name: string
  row_count: number
  uploaded_by: string
  status: string
  created_at: string
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3">
            <div className="h-4 w-32 rounded bg-gray-200" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-16 rounded bg-gray-200" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 rounded bg-gray-200" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-16 rounded bg-gray-200" />
          </td>
          <td className="px-4 py-3">
            <div className="h-4 w-24 rounded bg-gray-200" />
          </td>
        </tr>
      ))}
    </>
  )
}

function DatasetsListInner() {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGet<DatasetListItem[]>('/datasets')
      .then(data => {
        if (cancelled) return
        setDatasets(data)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Couldn’t load datasets — please try again')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Datasets</h1>
        <Link
          href="/datasets/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Upload CSV
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn’t load datasets — {error}
        </div>
      )}

      {!loading && !error && datasets && datasets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-600">No datasets yet. Upload a CSV to get started.</p>
          <Link
            href="/datasets/upload"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload CSV
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Rows</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Uploaded by</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <SkeletonRows />
              ) : (
                datasets?.map(ds => (
                  <tr
                    key={ds.dataset_id}
                    onClick={() => router.push(`/datasets/${ds.dataset_id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{ds.name}</td>
                    <td className="px-4 py-3 text-gray-600">{ds.row_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-600">{ds.uploaded_by}</td>
                    <td className="px-4 py-3 text-gray-600">{ds.status}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(ds.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

export default function DatasetsPage() {
  return (
    <AuthGuard>
      <Nav />
      <DatasetsListInner />
    </AuthGuard>
  )
}
