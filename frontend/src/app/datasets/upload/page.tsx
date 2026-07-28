'use client'

import { useRef, useState } from 'react'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { apiUpload, ApiError } from '@/lib/api'
import { ProfilePanel, type DatasetProfile } from '@/components/profile-panel'

const MAX_CSV_MB = 100 // Assumption: hardcoded — no settings-exposing endpoint in Phase 1 (see spec/api.md).

type UploadResponse = {
  dataset_id: string
  name: string
  status: string
  profile: DatasetProfile
}

function UploadInner() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UploadResponse | null>(null)

  function pickFile(f: File | null) {
    setError(null)
    setFile(f)
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await apiUpload<UploadResponse>('/datasets/upload', formData)
      setResult(data)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Couldn’t reach the server — is it running?')
      }
    } finally {
      setUploading(false)
    }
  }

  if (result) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">Upload complete</h1>
        <ProfilePanel profile={result.profile} datasetId={result.dataset_id} datasetName={result.name} />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-gray-900">Upload CSV</h1>
      <p className="mb-6 text-sm text-gray-500">
        Upload a CSV file (up to {MAX_CSV_MB}MB) to ingest and profile it.
      </p>

      <div
        onDragOver={e => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const dropped = e.dataTransfer.files?.[0]
          if (dropped) pickFile(dropped)
        }}
        className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300'
        }`}
      >
        <p className="mb-3 text-sm text-gray-600">
          Drag and drop a .csv file here, or
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => pickFile(e.target.files?.[0] ?? null)}
          disabled={uploading}
        />
        {file && (
          <p className="mt-4 text-sm font-medium text-gray-900">{file.name}</p>
        )}
        <p className="mt-3 text-xs text-gray-400">Maximum file size: {MAX_CSV_MB}MB</p>
      </div>

      <button
        type="button"
        onClick={handleUpload}
        disabled={!file || uploading}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {uploading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            aria-hidden="true"
          />
        )}
        {uploading ? 'Uploading and profiling…' : 'Upload and profile'}
      </button>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </main>
  )
}

export default function UploadPage() {
  return (
    <AuthGuard>
      <Nav />
      <UploadInner />
    </AuthGuard>
  )
}
