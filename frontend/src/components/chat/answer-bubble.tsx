import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { QueryRunCompleted } from '@/lib/query'
import { CodePanel } from './code-panel'
import { StubRow } from './stub-row'

function formatKeyNumberValue(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}

function formatKeyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Completed-answer bubble: markdown answer, highlighted key numbers, assumptions
 * callout, code panel, token/cost line, and the Phase 2/3 stub row. */
export function AnswerBubble({ result }: { result: QueryRunCompleted }) {
  const keyNumberEntries = result.key_numbers ? Object.entries(result.key_numbers) : []
  const totalTokens = (result.prompt_tokens ?? 0) + (result.completion_tokens ?? 0)

  return (
    <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-gray-200 bg-white p-4 shadow-sm">
      <div className="prose prose-sm max-w-none text-gray-800">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.final_answer}</ReactMarkdown>
      </div>

      {keyNumberEntries.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4">
          {keyNumberEntries.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-blue-50 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-blue-500">
                {formatKeyLabel(key)}
              </div>
              <div className="text-xl font-bold text-blue-900">
                {formatKeyNumberValue(value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.assumptions && result.assumptions.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {result.assumptions.map((assumption, i) => (
            <div key={i}>
              <span className="font-semibold">Assumption:</span> {assumption}
            </div>
          ))}
        </div>
      )}

      <CodePanel attempts={result.attempts} />

      <div className="mt-3 text-xs text-gray-400">
        {totalTokens.toLocaleString()} tokens · ${result.estimated_cost_usd.toFixed(4)}
      </div>

      <StubRow />
    </div>
  )
}
