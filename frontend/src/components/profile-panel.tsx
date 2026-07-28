/**
 * Shared dataset-profile display, used by both the post-upload success view
 * (`/datasets/upload`) and the dataset-detail view (`/datasets/[id]`).
 *
 * Renders: row count, column list (dtype/null-count/distinct-count/sample
 * values/min/max), detected date range, and a Data Quality section listing
 * every detected issue in plain language. Also renders the Phase-1 stubs
 * that live next to a profile: a disabled "Combine with another file
 * (coming soon)" control and the "Ask a question about this dataset"
 * primary action.
 */

import Link from 'next/link'

export type ProfileColumn = {
  name: string
  dtype: string
  null_count: number
  distinct_count?: number
  sample_values?: string[]
  min?: string
  max?: string
}

export type ProfileQualityIssue = {
  issue_type: string
  column: string
  affected_row_count: number
  examples: string[]
}

export type DatasetProfile = {
  row_count: number
  columns: ProfileColumn[]
  date_range: { start: string; end: string } | null
  quality_issues: ProfileQualityIssue[]
}

/** Turn a machine issue_type + column + examples into a plain-language sentence. */
function describeIssue(issue: ProfileQualityIssue): string {
  const example = issue.examples[0]
  const readable = issue.issue_type.replace(/_/g, ' ')
  const base = `${issue.affected_row_count} row${issue.affected_row_count === 1 ? '' : 's'} in \`${issue.column}\` ${readable}`
  return example ? `${base}, e.g. '${example}'` : base
}

export function ProfilePanel({
  profile,
  datasetId,
  datasetName,
}: {
  profile: DatasetProfile
  datasetId: string
  datasetName?: string
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {datasetName && (
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">{datasetName}</h2>
          )}
          <p className="mt-1 text-sm text-gray-600">
            {profile.row_count.toLocaleString()} rows · {profile.columns.length} columns
            {profile.date_range && (
              <>
                {' '}
                · {profile.date_range.start} to {profile.date_range.end}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled
            title="Combine with another file — coming in Phase 2"
            className="cursor-not-allowed rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-400 opacity-50"
          >
            Combine with another file (coming soon)
          </button>
          <Link
            href={`/datasets/${datasetId}/ask`}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Ask a question about this dataset
          </Link>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Columns</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Column</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nulls</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Distinct</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Sample values / range</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {profile.columns.map(col => (
                <tr key={col.name}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{col.name}</td>
                  <td className="px-4 py-2 text-gray-600">{col.dtype}</td>
                  <td className="px-4 py-2 text-gray-600">{col.null_count}</td>
                  <td className="px-4 py-2 text-gray-600">{col.distinct_count ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {col.sample_values && col.sample_values.length > 0
                      ? col.sample_values.join(', ')
                      : col.min !== undefined || col.max !== undefined
                        ? `${col.min ?? '?'} – ${col.max ?? '?'}`
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Data Quality</h3>
        {profile.quality_issues.length === 0 ? (
          <p className="text-sm text-gray-500">No data-quality issues detected.</p>
        ) : (
          <ul className="space-y-2">
            {profile.quality_issues.map((issue, i) => (
              <li
                key={`${issue.issue_type}-${issue.column}-${i}`}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                {describeIssue(issue)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
