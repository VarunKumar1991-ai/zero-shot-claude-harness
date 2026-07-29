'use client'

import ComingSoonBadge from './ComingSoonBadge'

/**
 * Phase-1 placeholder for the profile card's "Add column annotation" control.
 * The `annotations` table already exists (Phase 1 migration) but the
 * editor UI and API are Phase-2 work — this control stays disabled until
 * `annotations-api` + `frontend-charts-export-annotations` ship.
 */
export default function AnnotationStub() {
  return (
    <div className="inline-flex items-center gap-2" aria-disabled="true">
      <button
        type="button"
        disabled
        title="Coming in Phase 2 — add business-rule notes to a column"
        className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400"
      >
        + Add column annotation
      </button>
      <ComingSoonBadge />
    </div>
  )
}
