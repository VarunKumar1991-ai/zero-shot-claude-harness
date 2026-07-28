'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AuthGuard } from '@/components/auth-guard'
import { Nav } from '@/components/nav'
import { StepProgress } from '@/components/chat/step-progress'
import { AnswerBubble } from '@/components/chat/answer-bubble'
import { QuestionBubble, ClarificationBubble, FailedBubble } from '@/components/chat/other-bubbles'
import { ApiError } from '@/lib/api'
import {
  getConversation,
  getDataset,
  getQueryRun,
  submitQuery,
  type ConversationTurn,
  type QueryRunCompleted,
} from '@/lib/query'

const EXAMPLE_QUESTIONS = [
  'How many thefts were reported in June?',
  'What are the most common offence types this year?',
]

const POLL_INTERVAL_MS = 1000

type Item =
  | { kind: 'history'; queryRunId: string; question: string; finalAnswer: string | null; status: string }
  | { kind: 'live-pending'; queryRunId: string | null; question: string; currentNode: string | null }
  | { kind: 'live-completed'; queryRunId: string; question: string; result: QueryRunCompleted }
  | { kind: 'live-clarification'; queryRunId: string; question: string; clarifyingQuestion: string }
  | { kind: 'live-failed'; queryRunId: string; question: string; error: string }

export function AskPageClient() {
  const params = useParams<{ id: string }>()
  const datasetId = params.id

  const [datasetName, setDatasetName] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollAnchor = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    getDataset(datasetId)
      .then(d => {
        if (!cancelled) setDatasetName(d.name)
      })
      .catch(() => {
        /* header name is a nice-to-have; page still works without it */
      })

    getConversation(datasetId)
      .then((turns: ConversationTurn[]) => {
        if (cancelled) return
        setItems(
          turns.map(t => ({
            kind: 'history',
            queryRunId: t.query_run_id,
            question: t.question,
            finalAnswer: t.final_answer,
            status: t.status,
          }))
        )
        setHistoryLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setHistoryError(
          err instanceof ApiError ? err.message : 'Couldn’t reach the server — is it running?'
        )
        setHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [datasetId])

  // Stop polling on unmount, no matter what stage we're at.
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [])

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items])

  function updateAt(index: number, item: Item) {
    setItems(prev => prev.map((it, i) => (i === index ? item : it)))
  }

  function pollQueryRun(queryRunId: string, index: number) {
    if (pollTimer.current) clearInterval(pollTimer.current)

    pollTimer.current = setInterval(async () => {
      try {
        const result = await getQueryRun(datasetId, queryRunId)

        if (result.status === 'pending') {
          updateAt(index, {
            kind: 'live-pending',
            queryRunId,
            question: items[index]?.question ?? '',
            currentNode: result.current_node,
          })
          return
        }

        if (pollTimer.current) clearInterval(pollTimer.current)
        setBusy(false)

        const question = items[index]?.question ?? ''

        if (result.status === 'completed') {
          updateAt(index, { kind: 'live-completed', queryRunId, question, result })
        } else if (result.status === 'needs_clarification') {
          updateAt(index, {
            kind: 'live-clarification',
            queryRunId,
            question,
            clarifyingQuestion: result.clarifying_question,
          })
        } else if (result.status === 'failed') {
          updateAt(index, { kind: 'live-failed', queryRunId, question, error: result.error })
        }
      } catch (err) {
        if (pollTimer.current) clearInterval(pollTimer.current)
        setBusy(false)
        const question = items[index]?.question ?? ''
        updateAt(index, {
          kind: 'live-failed',
          queryRunId,
          question,
          error:
            err instanceof ApiError ? err.message : 'Couldn’t reach the server — is it running?',
        })
      }
    }, POLL_INTERVAL_MS)
  }

  async function ask(questionText: string) {
    const question = questionText.trim()
    if (!question || busy) return

    setInput('')
    setBusy(true)

    const index = items.length
    setItems(prev => [...prev, { kind: 'live-pending', queryRunId: null, question, currentNode: null }])

    try {
      const { query_run_id } = await submitQuery(datasetId, question)
      updateAt(index, { kind: 'live-pending', queryRunId: query_run_id, question, currentNode: null })
      pollQueryRun(query_run_id, index)
    } catch (err) {
      setBusy(false)
      updateAt(index, {
        kind: 'live-failed',
        queryRunId: 'submit-error',
        question,
        error:
          err instanceof ApiError ? err.message : 'Couldn’t reach the server — is it running?',
      })
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    ask(input)
  }

  return (
    <AuthGuard>
      <Nav activeDatasetId={datasetId} />
      <main className="mx-auto flex min-h-[calc(100vh-57px)] max-w-3xl flex-col px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">
          Ask {datasetName ? `— ${datasetName}` : ''}
        </h1>

        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {historyLoading && (
            <div className="space-y-3">
              <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-gray-100" />
              <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-gray-100" />
            </div>
          )}

          {historyError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Couldn’t load conversation history — {historyError}
            </div>
          )}

          {!historyLoading && !historyError && items.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
              <p className="mb-4 text-sm text-gray-500">
                Ask anything about this dataset — e.g. &ldquo;How many thefts were reported in
                June?&rdquo;
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLE_QUESTIONS.map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setInput(q)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item, i) => (
            <div key={item.queryRunId ?? `pending-${i}`} className="space-y-2">
              <QuestionBubble question={item.question} />

              {item.kind === 'history' &&
                (item.status === 'completed' && item.finalAnswer ? (
                  <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="prose prose-sm max-w-none text-gray-800">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.finalAnswer}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : item.status === 'needs_clarification' ? (
                  <ClarificationBubble clarifyingQuestion="This question needed clarification — ask it again with more detail." />
                ) : (
                  <FailedBubble error="This question did not complete successfully." />
                ))}

              {item.kind === 'live-pending' && <StepProgress currentNode={item.currentNode} />}

              {item.kind === 'live-completed' && <AnswerBubble result={item.result} />}

              {item.kind === 'live-clarification' && (
                <ClarificationBubble clarifyingQuestion={item.clarifyingQuestion} />
              )}

              {item.kind === 'live-failed' && <FailedBubble error={item.error} />}
            </div>
          ))}

          <div ref={scrollAnchor} />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2 border-t border-gray-200 pt-4">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={busy}
            placeholder="Ask a question about this dataset…"
            className="flex-1 rounded-lg border border-gray-300 p-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </form>
      </main>
    </AuthGuard>
  )
}
