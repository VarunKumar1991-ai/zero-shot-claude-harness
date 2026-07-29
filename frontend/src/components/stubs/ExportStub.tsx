'use client'

import ComingSoonBadge from './ComingSoonBadge'

/**
 * Phase-1 placeholder for the "Export findings" action.
 * Renders as a real-looking button, `disabled`, with a tooltip and inline
 * badge explaining it's a Phase-2 feature.
 */
export default function ExportStub() {
  return (
    <div className="inline-flex items-center gap-2" aria-disabled="true">
      <button
        type="button"
        disabled
        title="Coming in Phase 2 — export findings as CSV/PDF"
        className="cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400"
      >
        Export findings
      </button>
      <ComingSoonBadge />
    </div>
  )
}
