'use client'

import ComingSoonBadge from './ComingSoonBadge'

/**
 * Phase-1 placeholder for the multi-file combine/join picker.
 * Visually consistent with the real dataset UI, but every control is
 * `disabled` and inert — no dead click handlers. Ships as a structural
 * preview of the Phase-2 feature so it's never mistaken for a bug.
 */
export default function MultiFileJoinStub() {
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm opacity-70"
      aria-disabled="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Combine with another file</h3>
        <ComingSoonBadge />
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Join or combine same-schema CSVs into one logical dataset for cross-file questions.
      </p>
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2"
        title="Coming in Phase 2 — multi-file combine and join"
      >
        <select
          disabled
          aria-disabled="true"
          className="flex-1 cursor-not-allowed rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-400"
          defaultValue=""
        >
          <option value="">Select a dataset to join…</option>
        </select>
        <button
          type="button"
          disabled
          title="Coming in Phase 2 — multi-file combine and join"
          className="cursor-not-allowed rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400"
        >
          Join
        </button>
      </div>
    </section>
  )
}
