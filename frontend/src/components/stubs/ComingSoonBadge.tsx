/**
 * Shared "Coming soon" visual badge used by every Phase-1 stub component.
 * Not a route-level component — a small internal helper so every stub in
 * this directory carries an identical, unmistakable placeholder marker.
 */
export default function ComingSoonBadge({ label = 'Coming soon — Phase 2' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
          clipRule="evenodd"
        />
      </svg>
      {label}
    </span>
  )
}
