'use client'

import { useState } from 'react'
import type { QueryAttempt } from '@/lib/types'

type Props = {
  generatedCode: string | null
  attempts: QueryAttempt[]
}

/** Collapsed-by-default expandable panel showing the exact code that ran
 * against the officer's data, plus every retry attempt (including failures)
 * on further expand. Never shown expanded by default — the plain-language
 * answer is the primary surface. */
export default function CodeDisclosure({ generatedCode, attempts }: Props) {
  const [codeOpen, setCodeOpen] = useState(false)
  const [attemptsOpen, setAttemptsOpen] = useState(false)

  // `generatedCode` reflects only the FINAL generate_code call in the retry
  // loop. If that final call itself failed (e.g. an LLM outage/quota error
  // on a later retry — src/agent/nodes/generateCode.js blanks generatedCode
  // to "" in that case), a prior attempt in `attempts` may still hold real
  // code that actually ran. Fall back to the most recent attempt with
  // non-empty code so the top-level panel always shows "the exact generated
  // JS that ran" (spec/ui.md) instead of silently discarding it.
  const displayCode =
    generatedCode || [...attempts].reverse().find(a => a.code)?.code || null

  if (!displayCode && attempts.length === 0) return null

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={() => setCodeOpen(o => !o)}
        aria-expanded={codeOpen}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800"
      >
        <span aria-hidden="true">{codeOpen ? '▾' : '▸'}</span>
        {codeOpen ? 'Hide code' : 'Show code'}
      </button>

      {codeOpen && (
        <div className="mt-2 space-y-3">
          {displayCode && (
            <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
              <code>{displayCode}</code>
            </pre>
          )}

          {attempts.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setAttemptsOpen(o => !o)}
                aria-expanded={attemptsOpen}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
              >
                <span aria-hidden="true">{attemptsOpen ? '▾' : '▸'}</span>
                {attemptsOpen
                  ? 'Hide all attempts'
                  : `Show all attempts (${attempts.length})`}
              </button>

              {attemptsOpen && (
                <ol className="mt-2 space-y-2">
                  {attempts.map((attempt, i) => (
                    <li
                      key={i}
                      className={`rounded-md border p-2.5 text-xs ${
                        attempt.executionResult.error
                          ? 'border-red-200 bg-red-50'
                          : 'border-green-200 bg-green-50'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-semibold text-gray-700">Attempt {i + 1}</span>
                        <span
                          className={
                            attempt.executionResult.error ? 'text-red-700' : 'text-green-700'
                          }
                        >
                          {attempt.executionResult.error ? 'Failed' : attempt.inspection}
                        </span>
                      </div>
                      <pre className="overflow-x-auto rounded bg-gray-900 p-2 text-[11px] text-gray-100">
                        <code>{attempt.code}</code>
                      </pre>
                      {attempt.executionResult.error && (
                        <p className="mt-1 text-red-700">{attempt.executionResult.error}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
