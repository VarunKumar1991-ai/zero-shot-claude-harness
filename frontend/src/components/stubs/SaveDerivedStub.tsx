'use client'

import ComingSoonBadge from './ComingSoonBadge'

/**
 * Phase-1 placeholder for the per-answer "Save as new dataset" action.
 * Phase 2 wires this to `POST /api/datasets/:id/queries/:qid/save-as-dataset`.
 */
export default function SaveDerivedStub() {
  return (
    <div className="inline-flex items-center gap-2" aria-disabled="true">
      <button
        type="button"
        disabled
        title="Coming in Phase 2 — save this result as a new reusable dataset"
        className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
      >
        Save as new dataset
      </button>
      <ComingSoonBadge />
    </div>
  )
}
