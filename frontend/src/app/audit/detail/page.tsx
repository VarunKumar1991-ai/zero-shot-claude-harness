'use client'

/**
 * Audit detail screen for one query run — `GET /audit/{query_run_id}`.
 * Shown when an analyst drills into a `type: "query"` row on the Audit Log
 * table (`spec/ui.md` → Screen: Audit Log, "clicking a query row opens its
 * full detail"). Renders the question, final answer, key numbers,
 * assumptions, and every attempt's code/result/error, oldest first, for
 * scrutiny.
 */

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { apiGet, ApiError } from '@/lib/api'
import type { AuditQueryDetail } from '@/components/audit/types'

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * `next export` requires dynamic route segments to be known at build time
 * via `generateStaticParams`, which is impossible for runtime query-run
 * UUIDs. Using a query-string param (`?query_run_id=...`) on a static page
 * avoids that limitation while still being a real, linkable, bookmarkable
 * route.
 */
function AuditQueryDetailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryRunId = searchParams.get('query_run_id') ?? ''

  const [detail, setDetail] = useState<AuditQueryDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'not_found'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!queryRunId) {
      setStatus('not_found')
      return
    }
    let cancelled = false
    setStatus('loading')
    apiGet<AuditQueryDetail>(`/audit/${queryRunId}`)
      .then(res => {
        if (cancelled) return
        setDetail(res)
        setStatus('ready')
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setStatus('not_found')
        } else {
          setErrorMessage(
            err instanceof ApiError ? err.message : 'Couldn’t reach the server — is it running?'
          )
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [queryRunId])

  return (
    <AuthGuard>
      <Nav />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <button
          type="button"
          onClick={() => router.push('/audit')}
          className="mb-4 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          ← Back to Audit Log
        </button>

        {status === 'loading' && (
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200" />
            <div className="h-24 w-full animate-pulse rounded bg-gray-200" />
          </div>
        )}

        {status === 'not_found' && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
            This query run could not be found.
          </div>
        )}

        {status === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            Couldn’t load this query's detail — {errorMessage}
          </div>
        )}

        {status === 'ready' && detail && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Query detail</h1>
              <p className="mt-1 text-sm text-gray-500">
                {detail.user} · {detail.dataset} · {formatTimestamp(detail.started_at)}
                {detail.completed_at ? ` – ${formatTimestamp(detail.completed_at)}` : ''}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Status: {detail.status}
                {detail.prompt_tokens != null && detail.completion_tokens != null && (
                  <>
                    {' '}
                    · {(detail.prompt_tokens + detail.completion_tokens).toLocaleString()} tokens
                    {detail.estimated_cost_usd != null && ` · $${detail.estimated_cost_usd.toFixed(4)}`}
                  </>
                )}
              </p>
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Question</h2>
              <p className="text-sm text-gray-700">{detail.question}</p>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-1 text-sm font-semibold text-gray-900">Answer</h2>
              {detail.final_answer ? (
                <p className="text-sm text-gray-700">{detail.final_answer}</p>
              ) : (
                <p className="text-sm text-gray-400">No answer was produced.</p>
              )}

              {detail.key_numbers && Object.keys(detail.key_numbers).length > 0 && (
                <dl className="mt-3 flex flex-wrap gap-4">
                  {Object.entries(detail.key_numbers).map(([k, v]) => (
                    <div key={k} className="rounded-md bg-blue-50 px-3 py-2">
                      <dt className="text-xs font-medium text-blue-600">{k}</dt>
                      <dd className="text-sm font-semibold text-blue-900">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {detail.assumptions.length > 0 && (
                <div className="mt-3 space-y-1">
                  {detail.assumptions.map((a, i) => (
                    <p
                      key={i}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      Assumption: {a}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">
                Attempts ({detail.attempts.length})
              </h2>
              {detail.attempts.length === 0 ? (
                <p className="text-sm text-gray-500">No attempts were recorded.</p>
              ) : (
                <div className="space-y-3">
                  {detail.attempts
                    .slice()
                    .sort((a, b) => a.attempt_number - b.attempt_number)
                    .map(attempt => (
                      <div
                        key={attempt.attempt_number}
                        className="rounded-lg border border-gray-200 bg-white p-4"
                      >
                        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                          <span>Attempt {attempt.attempt_number}</span>
                          <span>{attempt.duration_ms} ms</span>
                        </div>
                        <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
                          <code>{attempt.generated_code}</code>
                        </pre>
                        {attempt.execution_error ? (
                          <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                            {attempt.execution_error}
                          </p>
                        ) : (
                          <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-2 text-xs text-gray-700">
                            {JSON.stringify(attempt.execution_result, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </AuthGuard>
  )
}

export default function AuditQueryDetailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-gray-400">Loading…</div>}>
      <AuditQueryDetailInner />
    </Suspense>
  )
}
