import { AskPageClient } from './ask-client'

/**
 * `output: 'export'` requires every dynamic segment to enumerate its static
 * params at build time. Real `dataset_id` values only exist at runtime, so
 * there is nothing to enumerate ahead of time — this renders a single
 * placeholder shell and `AskPageClient` reads the real id from the browser
 * URL via `useParams()` once the JS bundle hydrates (client-side navigation
 * from the dataset list/profile screen works regardless of the id value,
 * since the whole subtree below is a Client Component that fetches its own
 * data). See the sibling `/datasets/[id]/page.tsx` for the same pattern and
 * its note on hard-refresh/direct-URL-entry needing a backend SPA fallback
 * (out of scope for this frontend slice).
 */
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function AskPage() {
  return <AskPageClient />
}
