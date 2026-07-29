'use client'

import { useState } from 'react'
import type { DatasetProfile } from '@/lib/types'
import AnnotationStub from '@/components/stubs/AnnotationStub'

type Props = {
  profile: DatasetProfile
}

/** Renders the real, Phase-1 auto-generated dataset profile: columns +
 * inferred types, row count, date range, and a collapsible quality-flag
 * summary. Never silently drops or hides quality issues. */
export default function ProfileCard({ profile }: Props) {
  const [flagsOpen, setFlagsOpen] = useState(profile.qualityFlags.length > 0)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{profile.name}</h2>
          <p className="text-sm text-gray-500">
            {profile.rowCount.toLocaleString()} rows
            {profile.dateRangeMin && profile.dateRangeMax
              ? ` · ${profile.dateRangeMin} to ${profile.dateRangeMax}`
              : ''}
          </p>
        </div>
        <AnnotationStub />
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Columns ({profile.columns.length})
        </h3>
        {profile.columns.length === 0 ? (
          <p className="text-sm text-gray-400">No columns detected.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.columns.map(col => (
              <span
                key={col.name}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
              >
                <span className="font-medium">{col.name}</span>
                <span className="text-gray-400">{col.inferredType}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setFlagsOpen(o => !o)}
          className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
          aria-expanded={flagsOpen}
        >
          <span>
            Data-quality warnings
            {profile.qualityFlags.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {profile.qualityFlags.length}
              </span>
            )}
          </span>
          <span aria-hidden="true">{flagsOpen ? '−' : '+'}</span>
        </button>

        {flagsOpen && (
          <div className="mt-2">
            {profile.qualityFlags.length === 0 ? (
              <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                No data-quality issues detected.
              </p>
            ) : (
              <ul className="space-y-2">
                {profile.qualityFlags.map((flag, i) => (
                  <li
                    key={`${flag.type}-${i}`}
                    className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                  >
                    <span className="font-medium">{flag.type.replace(/_/g, ' ')}</span>
                    {' — '}
                    {flag.count} row{flag.count === 1 ? '' : 's'}
                    {flag.sampleRowRefs.length > 0 && (
                      <span className="text-amber-700">
                        {' '}
                        (e.g. rows {flag.sampleRowRefs.slice(0, 5).join(', ')})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
