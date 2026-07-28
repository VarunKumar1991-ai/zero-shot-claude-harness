/**
 * Real step-counter / progress indicator for an in-flight query.
 *
 * Maps the REAL polled `current_node` (from `GET /datasets/{id}/queries/{id}`)
 * to a human label and an approximate step number out of the ~9 nodes in the
 * graph's main path (see `spec/agent.md` → Graph / Flow Topology). This must
 * never degrade into a generic spinner — the label always reflects the actual
 * node last reported by the backend.
 */

const STEP_LABELS: Record<string, { step: number; label: string }> = {
  load_context: { step: 1, label: 'Loading dataset context…' },
  classify_and_assess: { step: 2, label: 'Classifying the question…' },
  plan_analysis: { step: 3, label: 'Planning the analysis…' },
  generate_code: { step: 4, label: 'Writing analysis code…' },
  execute_code: { step: 5, label: 'Running the code…' },
  inspect_result: { step: 6, label: 'Checking the result…' },
  synthesize_answer: { step: 7, label: 'Writing the answer…' },
  suggest_followups: { step: 8, label: 'Wrapping up…' },
  finalize: { step: 9, label: 'Saving the record…' },
}

const TOTAL_STEPS = 9

export function StepProgress({ currentNode }: { currentNode: string | null }) {
  const known = currentNode ? STEP_LABELS[currentNode] : undefined
  const step = known?.step ?? 1
  const label = known?.label ?? (currentNode ? `Working (${currentNode})…` : 'Starting…')

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
      <span
        className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
        aria-hidden="true"
      />
      <span>
        Step {step} of ~{TOTAL_STEPS}: {label}
      </span>
    </div>
  )
}
