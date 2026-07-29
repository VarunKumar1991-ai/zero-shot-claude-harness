'use client'

import ComingSoonBadge from './ComingSoonBadge'

const EXAMPLE_FOLLOWUPS = ['What about July?', 'Break this down by station', 'Compare with last year']

/**
 * Phase-1 placeholder row of follow-up-question chips shown below an answer.
 * Shows plausible example text so officers understand the intended feature,
 * but every chip is a non-interactive `<span>` (not a `<button>`), with
 * `aria-disabled` and a tooltip — never a dead click handler.
 */
export default function FollowupChipsStub() {
  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Suggested follow-ups</span>
        <ComingSoonBadge />
      </div>
      <div className="flex flex-wrap gap-2" aria-disabled="true">
        {EXAMPLE_FOLLOWUPS.map(text => (
          <span
            key={text}
            title="Coming in Phase 2 — suggested follow-up questions"
            className="cursor-not-allowed select-none rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs text-gray-400"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  )
}
