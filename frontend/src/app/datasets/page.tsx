'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiUpload, ApiError, isSessionExpired } from '@/lib/api'
import type { DatasetProfile, DatasetSummary } from '@/lib/types'
import MultiFileJoinStub from '@/components/stubs/MultiFileJoinStub'

type LoadState = 'loading' | 'error' | 'ready'

type UploadStage = 'idle' | 'uploading' | 'flags' | 'error'

export default function DatasetListPage() {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingProfile, setPendingProfile] = useState<DatasetProfile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadDatasets = useCallback(() => {
    setLoadState('loading')
    setLoadError(null)
    apiGet<DatasetSummary[]>('/datasets')
      .then(list => {
        setDatasets(list)
        setLoadState('ready')
      })
      .catch(err => {
        if (isSessionExpired(err)) {
          router.push('/login?expired=1')
          return
        }
        setLoadError(err instanceof Error ? err.message : 'Failed to load datasets')
        setLoadState('error')
      })
  }, [router])

  useEffect(() => {
    loadDatasets()
  }, [loadDatasets])

  async function submitUpload(exclude: boolean) {
    if (!file) return
    setUploadStage('uploading')
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (name.trim()) form.append('name', name.trim())
      form.append('excludeBadRows', String(exclude))
      const profile = await apiUpload<DatasetProfile>('/datasets', form)

      if (!exclude && profile.qualityFlags.length > 0) {
        setPendingProfile(profile)
        setUploadStage('flags')
        return
      }

      resetUploadForm()
      loadDatasets()
      router.push(`/datasets/${profile.id}`)
    } catch (err) {
      if (isSessionExpired(err)) {
        router.push('/login?expired=1')
        return
      }
      const message =
        err instanceof ApiError
          ? err.status === 413
            ? 'That file is too large (max ~100MB)'
            : err.status === 422
              ? "That file couldn't be read as CSV — check it's not corrupted"
              : err.message
          : "That file couldn't be read as CSV — check it's not corrupted"
      setUploadError(message)
      setUploadStage('error')
    }
  }

  function resetUploadForm() {
    setFile(null)
    setName('')
    setUploadStage('idle')
    setUploadError(null)
    setPendingProfile(null)
    setShowUpload(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Datasets</h1>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Upload CSV
        </button>
      </div>

      {showUpload && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Upload a CSV</h2>
            <button
              type="button"
              onClick={resetUploadForm}
              className="text-sm text-gray-400 hover:text-gray-600"
              aria-label="Close upload dialog"
            >
              ✕
            </button>
          </div>

          {uploadStage === 'flags' && pendingProfile ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{pendingProfile.rowCount.toLocaleString()}</span>{' '}
                rows, {pendingProfile.columns.length} columns detected.
              </p>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="mb-1 font-semibold">Data-quality issues found:</p>
                <ul className="list-inside list-disc space-y-1">
                  {pendingProfile.qualityFlags.map((flag, i) => (
                    <li key={i}>
                      {flag.type.replace(/_/g, ' ')} — {flag.count} row
                      {flag.count === 1 ? '' : 's'}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => submitUpload(true)}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Exclude bad rows and continue
                </button>
                <button
                  type="button"
                  onClick={resetUploadForm}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel and re-upload a fixed file
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault()
                submitUpload(false)
              }}
              className="space-y-3"
            >
              <div>
                <label htmlFor="csv-file" className="mb-1 block text-sm font-medium text-gray-700">
                  CSV file (up to ~100MB)
                </label>
                <input
                  ref={fileInputRef}
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  disabled={uploadStage === 'uploading'}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                  required
                />
              </div>
              <div>
                <label htmlFor="csv-name" className="mb-1 block text-sm font-medium text-gray-700">
                  Name <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  id="csv-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  disabled={uploadStage === 'uploading'}
                  placeholder="Defaults to the filename"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {uploadError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {uploadError}
                </div>
              )}

              <button
                type="submit"
                disabled={!file || uploadStage === 'uploading'}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadStage === 'uploading' && (
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden="true"
                  />
                )}
                {uploadStage === 'uploading' ? 'Uploading and profiling…' : 'Upload'}
              </button>
            </form>
          )}
        </div>
      )}

      {loadState === 'loading' && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      )}

      {loadState === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <p className="mb-3">{loadError ?? 'Failed to load datasets'}</p>
          <button
            type="button"
            onClick={loadDatasets}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      )}

      {loadState === 'ready' && datasets.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="mb-4 text-sm text-gray-500">No datasets yet — upload a CSV to get started.</p>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload your first CSV
          </button>
        </div>
      )}

      {loadState === 'ready' && datasets.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {datasets.map(ds => (
                <tr
                  key={ds.id}
                  onClick={() => router.push(`/datasets/${ds.id}`)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{ds.name}</td>
                  <td className="px-4 py-3 text-gray-600">{ds.rowCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(ds.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MultiFileJoinStub />
    </div>
  )
}
