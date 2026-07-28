/**
 * Row of labelled, visibly-disabled Phase-2/3 stub actions shown under every
 * completed answer. None of these are clickable in Phase 1 — each carries a
 * `title` tooltip naming the phase it arrives in, so it reads as a preview of
 * what's coming, never as a bug (per `spec/ui.md` → Ask screen + Phase 1
 * "labelled non-functional stub" rule).
 */

function StubButton({ label, phase }: { label: string; phase: string }) {
  return (
    <button
      type="button"
      disabled
      title={`Coming in ${phase} — not built yet`}
      className="cursor-not-allowed rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-400"
    >
      {label}
    </button>
  )
}

export function StubRow() {
  return (
    <div className="mt-3 space-y-2">
      <div
        className="flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400"
        title="Charts arrive in Phase 3 — not built yet"
      >
        Chart (coming soon)
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StubButton label="Export (coming soon)" phase="Phase 3" />
        <StubButton label="Save as new dataset (coming soon)" phase="Phase 2" />
      </div>

      <div>
        <div className="mb-1 text-xs text-gray-400">Suggested follow-ups (coming soon)</div>
        <div className="flex flex-wrap gap-2">
          {['Follow-up 1', 'Follow-up 2'].map(label => (
            <span
              key={label}
              title="Suggested follow-ups arrive in Phase 3 — not built yet"
              className="cursor-not-allowed rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs text-gray-400"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
