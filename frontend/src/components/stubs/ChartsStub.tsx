'use client'

import ComingSoonBadge from './ComingSoonBadge'

/**
 * Phase-1 placeholder for the trend-charts panel/tab. Intentionally inert —
 * no charting library is wired up here; Phase 2 replaces this with real
 * interactive bar/line/pie charts (recharts).
 */
export default function ChartsStub() {
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm opacity-70"
      aria-disabled="true"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Charts</h3>
        <ComingSoonBadge label="Coming soon — trend charts" />
      </div>
      <div
        className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 text-gray-400"
        title="Coming in Phase 2 — interactive trend charts"
      >
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16M7 16v-5m5 5V8m5 8v-3" />
        </svg>
        <p className="text-xs">Trend charts for this dataset will appear here</p>
      </div>
    </section>
  )
}
