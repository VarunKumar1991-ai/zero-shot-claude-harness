'use client'

/**
 * Audit Log screen — read-only, filterable record of every login, upload,
 * and query (`spec/ui.md` → Screen: Audit Log). Backed by `GET /audit`.
 *
 * Filter bar (user, dataset, date range) refetches on change (debounced).
 * Table paginates via `page`/`page_size`/`total`. Clicking a `type: "query"`
 * row navigates to `/audit/{query_run_id}` for the full attempt-by-attempt
 * detail view (`GET /audit/{query_run_id}`) — login/logout/upload rows have
 * no detail endpoint and are not clickable.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { apiGet, ApiError } from '@/lib/api'
import { auditTypeLabel, type AuditItem, type AuditListResponse } from '@/components/audit/types'

const PAGE_SIZE = 50

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export default function AuditLogPage() {
  const router = useRouter()
  const [userFilter, setUserFilter] = useState('')
  const [datasetFilter, setDatasetFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  // Debounced copies actually sent to the API, so typing doesn't refetch on every keystroke.
  const [debounced, setDebounced] = useState({ user: '', dataset: '', from: '', to: '' })

  const [page, setPage] = useState(1)
  const [items, setItems] = useState<AuditItem[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced({ user: userFilter.trim(), dataset: datasetFilter.trim(), from: fromFilter, to: toFilter })
      setPage(1)
    }, 300)
    return () => clearTimeout(handle)
  }, [userFilter, datasetFilter, fromFilter, toFilter])

  const load = useCallback(async () => {
    setStatus('loading')
    setErrorMessage(null)
    const params = new URLSearchParams()
    if (debounced.user) params.set('user_id', debounced.user)
    if (debounced.dataset) params.set('dataset_id', debounced.dataset)
    if (debounced.from) params.set('from', debounced.from)
    if (debounced.to) params.set('to', debounced.to)
    params.set('page', String(page))
    params.set('page_size', String(PAGE_SIZE))

    try {
      const res = await apiGet<AuditListResponse>(`/audit?${params.toString()}`)
      setItems(res.items)
      setTotal(res.total)
      setStatus('ready')
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.message : 'Couldn’t reach the server — is it running?'
      )
      setStatus('error')
    }
  }, [debounced, page])

  useEffect(() => {
    load()
  }, [load])

  const hasNextPage = page * PAGE_SIZE < total
  const hasPrevPage = page > 1

  return (
    <AuthGuard>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold tracking-tight text-gray-900">Audit Log</h1>

        <form
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4"
          onSubmit={e => e.preventDefault()}
        >
          <div>
            <label htmlFor="filter-user" className="mb-1 block text-xs font-medium text-gray-500">
              User
            </label>
            <input
              id="filter-user"
              type="text"
              placeholder="Username or user id"
              className="w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={userFilter}
              onChange={e => setUserFilter(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-dataset" className="mb-1 block text-xs font-medium text-gray-500">
              Dataset
            </label>
            <input
              id="filter-dataset"
              type="text"
              placeholder="Dataset name or id"
              className="w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={datasetFilter}
              onChange={e => setDatasetFilter(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-from" className="mb-1 block text-xs font-medium text-gray-500">
              From
            </label>
            <input
              id="filter-from"
              type="date"
              className="w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={fromFilter}
              onChange={e => setFromFilter(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="filter-to" className="mb-1 block text-xs font-medium text-gray-500">
              To
            </label>
            <input
              id="filter-to"
              type="date"
              className="w-full rounded-md border border-gray-300 p-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={toFilter}
              onChange={e => setToFilter(e.target.value)}
            />
          </div>
        </form>

        {status === 'error' && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            Couldn’t load the audit log — {errorMessage}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Timestamp</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">User</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Action</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Dataset</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status === 'loading' &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 w-full max-w-[10rem] animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))}

              {status === 'ready' && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No activity yet
                  </td>
                </tr>
              )}

              {status === 'ready' &&
                items.map((item, i) => {
                  const isQuery = item.type === 'query' && Boolean(item.query_run_id)
                  return (
                    <tr
                      key={`${item.type}-${item.timestamp}-${i}`}
                      onClick={
                        isQuery
                          ? () => router.push(`/audit/detail?query_run_id=${item.query_run_id}`)
                          : undefined
                      }
                      role={isQuery ? 'button' : undefined}
                      tabIndex={isQuery ? 0 : undefined}
                      onKeyDown={
                        isQuery
                          ? e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                router.push(`/audit/detail?query_run_id=${item.query_run_id}`)
                              }
                            }
                          : undefined
                      }
                      title={isQuery ? 'View full attempt history' : undefined}
                      className={isQuery ? 'cursor-pointer hover:bg-blue-50' : undefined}
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {formatTimestamp(item.timestamp)}
                      </td>
                      <td className="px-4 py-2 text-gray-900">{item.user}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            item.type === 'login_failure'
                              ? 'bg-red-50 text-red-700'
                              : item.type === 'query'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {auditTypeLabel(item.type)}
                          {item.status ? ` · ${item.status}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{item.dataset ?? '—'}</td>
                      <td className="px-4 py-2 max-w-md truncate text-gray-600" title={item.detail}>
                        {item.detail}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>

        {status === 'ready' && total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))} · {total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={!hasPrevPage}
                className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={!hasNextPage}
                className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    </AuthGuard>
  )
}
