/** Small bubble variants used on the Ask screen besides the completed-answer bubble. */

export function QuestionBubble({ question }: { question: string }) {
  return (
    <div className="ml-auto max-w-2xl rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-3 text-sm text-white">
      {question}
    </div>
  )
}

export function ClarificationBubble({
  clarifyingQuestion,
}: {
  clarifyingQuestion: string
}) {
  return (
    <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-purple-500">
        I need more detail
      </div>
      {clarifyingQuestion}
      <div className="mt-2 text-xs text-purple-500">
        Type your answer in the box below to continue.
      </div>
    </div>
  )
}

export function FailedBubble({ error }: { error: string }) {
  return (
    <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="mb-1 font-medium">
        Something went wrong generating this answer — please try again.
      </div>
      <div className="text-red-600">{error}</div>
    </div>
  )
}
