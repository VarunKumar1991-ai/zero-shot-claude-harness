import { DatasetDetailClient } from './dataset-detail-client'

/**
 * `output: 'export'` requires every dynamic segment to enumerate its static
 * params at build time. The real `dataset_id` values only exist at runtime
 * (created by users via `/datasets/upload`), so there is nothing to enumerate
 * ahead of time — this renders a single placeholder shell and the client
 * component below reads the *real* id from the browser URL via `useParams()`
 * once the JS bundle hydrates (client-side navigation, e.g. clicking a table
 * row on `/datasets`, works with this shell regardless of the id value since
 * this whole subtree is a Client Component that fetches its own data).
 *
 * NOTE / cross-slice concern: a full page load or hard refresh of
 * `/app/datasets/<real-uuid>/` goes straight to the FastAPI `StaticFiles`
 * mount (see `src/api/__init__.py`), which has no fallback for unmatched
 * nested paths and will 404 for any id other than this placeholder. Making
 * hard-refresh/direct-URL-entry work end-to-end requires a backend-side SPA
 * fallback (e.g. serve this placeholder's `index.html` for any unmatched
 * `/app/datasets/*` path) — that's backend surface, out of scope for this
 * frontend slice; flagging it here for agent-builder/qa-auditor.
 */
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function DatasetDetailPage() {
  return <DatasetDetailClient />
}
