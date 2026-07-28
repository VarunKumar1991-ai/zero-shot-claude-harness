'use client'

import { useState } from 'react'
import type { QueryAttempt } from '@/lib/query'

/**
 * "Show code" expandable panel — renders every attempt oldest-first (per
 * `spec/agent.md`'s `attempts` field and `spec/ui.md`'s Ask screen). When
 * there is more than one attempt (i.e. the code-generation/execution loop
 * retried), the last attempt without an `execution_error` is marked as the
 * one that succeeded; earlier attempts show their code + error so the retry
 * history is fully visible for audit purposes.
 */
export function CodePanel({ attempts }: { attempts: QueryAttempt[] }) {
  const [open, setOpen] = useState(false)

  if (!attempts || attempts.length === 0) return null

  const sorted = [...attempts].sort((a, b) => a.attempt_number - b.attempt_number)
  const successIndex = sorted.reduce(
    (found, attempt, i) => (attempt.execution_error ? found : i),
    -1
  )

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs font-medium text-blue-700 hover:underline"
      >
        {open ? 'Hide code' : 'Show code'}
        {sorted.length > 1 ? ` (${sorted.length} attempts)` : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {sorted.map((attempt, i) => {
            const succeeded = i === successIndex
            const failed = !!attempt.execution_error
            return (
              <div
                key={attempt.attempt_number}
                className={`rounded-lg border p-3 text-xs ${
                  failed
                    ? 'border-red-200 bg-red-50'
                    : succeeded
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="mb-1 flex items-center justify-between font-medium text-gray-600">
                  <span>
                    Attempt {attempt.attempt_number}
                    {sorted.length > 1 && succeeded && (
                      <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Succeeded
                      </span>
                    )}
                    {sorted.length > 1 && failed && (
                      <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Failed
                      </span>
                    )}
                  </span>
                  <span className="text-gray-400">{attempt.duration_ms} ms</span>
                </div>

                <pre className="overflow-x-auto rounded bg-gray-900 p-2 text-[11px] leading-snug text-gray-100">
                  <code>{attempt.generated_code}</code>
                </pre>

                {attempt.execution_error ? (
                  <div className="mt-2 rounded border border-red-200 bg-red-100 p-2 text-red-800">
                    {attempt.execution_error}
                  </div>
                ) : (
                  <div className="mt-2 rounded border border-gray-200 bg-white p-2 text-gray-700">
                    <span className="font-medium">Result: </span>
                    {JSON.stringify(attempt.execution_result)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
