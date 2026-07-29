'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiPost, ApiError, isSessionExpired } from '@/lib/api'
import type { QueryResult } from '@/lib/types'
import CodeDisclosure from '@/components/CodeDisclosure'
import FollowupChipsStub from '@/components/stubs/FollowupChipsStub'
import SaveDerivedStub from '@/components/stubs/SaveDerivedStub'

type Turn = {
  id: string
  question: string
  result: QueryResult | null
  errorMessage: string | null
}

type Props = {
  datasetId: string
  onSessionExpired: () => void
}

// The agent graph runs load_context -> classify -> plan -> generate_code ->
// execute_code -> inspect_result -> synthesize_answer -> finalize (spec/agent.md).
// api.md exposes a single request/response for POST /queries — no streaming
// channel is documented, so this stepper advances on a timer while the one
// request is in flight, purely so the officer sees this is real multi-step
// work rather than a frozen screen. It never claims the answer is ready
// until the real response arrives.
const STAGE_LABELS = [
  'Classifying question…',
  'Planning analysis…',
  'Generating analysis code…',
  'Running analysis…',
  'Checking the result…',
  'Writing the answer…',
]
const STAGE_INTERVAL_MS = 1800

export default function QAPanel({ datasetId, onSessionExpired }: Props) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [stageIndex, setStageIndex] = useState(0)
  const sessionIdRef = useRef<string>('')
  const historyEndRef = useRef<HTMLDivElement>(null)

  if (!sessionIdRef.current) {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  useEffect(() => {
    if (!loading) {
      setStageIndex(0)
      return
    }
    const timer = setInterval(() => {
      setStageIndex(i => Math.min(i + 1, STAGE_LABELS.length - 1))
    }, STAGE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [loading])

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, loading])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return

    setQuestion('')
    setLoading(true)

    try {
      const result = await apiPost<QueryResult>(`/datasets/${datasetId}/queries`, {
        question: q,
        sessionId: sessionIdRef.current,
      })
      setTurns(prev => [...prev, { id: result.id, question: q, result, errorMessage: null }])
    } catch (err) {
      if (isSessionExpired(err)) {
        onSessionExpired()
        return
      }
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't complete that analysis — the AI service didn't respond. Try again."
      setTurns(prev => [
        ...prev,
        { id: `error-${Date.now()}`, question: q, result: null, errorMessage: message },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="flex h-[32rem] flex-col rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {turns.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center text-center text-gray-400">
            <p className="max-w-sm text-sm">
              Ask a question about this dataset, e.g. &ldquo;How many thefts were reported in
              June?&rdquo;
            </p>
          </div>
        )}

        {turns.map(turn => (
          <div key={turn.id} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white">
              {turn.question}
            </div>

            {turn.errorMessage && (
              <div
                role="alert"
                className="max-w-[85%] rounded-lg rounded-bl-sm border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
              >
                {turn.errorMessage}
              </div>
            )}

            {turn.result && turn.result.status === 'needs_clarification' && (
              <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-500">
                  Needs more detail
                </p>
                <p>{turn.result.clarifyingQuestion}</p>
              </div>
            )}

            {turn.result && turn.result.status === 'completed' && (
              <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900">
                <div className="prose prose-sm max-w-none prose-p:my-1.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.result.answer ?? ''}</ReactMarkdown>
                </div>

                {turn.result.keyNumbers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {turn.result.keyNumbers.map((kn, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800"
                      >
                        {kn.label}: {kn.value}
                      </span>
                    ))}
                  </div>
                )}

                {turn.result.assumptions.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    <span className="font-semibold">Assumptions made: </span>
                    {turn.result.assumptions.join('; ')}
                  </div>
                )}

                <CodeDisclosure
                  generatedCode={turn.result.generatedCode}
                  attempts={turn.result.attempts}
                />

                <p className="mt-2 text-[11px] text-gray-400">
                  {turn.result.tokenUsage.promptTokens} in / {turn.result.tokenUsage.completionTokens}{' '}
                  out tokens
                </p>

                <div className="mt-2 flex items-center gap-3">
                  <SaveDerivedStub />
                </div>
                <FollowupChipsStub />
              </div>
            )}

            {turn.result && turn.result.status === 'failed' && (
              <div
                role="alert"
                className="max-w-[85%] rounded-lg rounded-bl-sm border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
              >
                Couldn&apos;t complete that analysis — the AI service didn&apos;t respond. Try
                again.
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
                aria-hidden="true"
              />
              <span>{STAGE_LABELS[stageIndex]}</span>
            </div>
            <ol className="mt-2 flex flex-wrap gap-x-1 gap-y-1 text-[11px] text-gray-400">
              {STAGE_LABELS.map((label, i) => (
                <li
                  key={label}
                  className={i <= stageIndex ? 'font-medium text-blue-600' : ''}
                >
                  {label.replace('…', '')}
                  {i < STAGE_LABELS.length - 1 ? ' →' : ''}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div ref={historyEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-gray-200 p-3">
        <label htmlFor="question" className="sr-only">
          Ask a question about this dataset
        </label>
        <textarea
          id="question"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Ask a question about this dataset…"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={loading}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && (
            <span
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
              aria-hidden="true"
            />
          )}
          Ask
        </button>
      </form>
    </section>
  )
}
