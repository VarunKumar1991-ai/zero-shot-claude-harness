import DatasetDetailView from '@/components/DatasetDetailView'

// This app is a Next.js `output: 'export'` static export mounted by Express
// at /app (see architecture.md's single-origin rule). Express serves this
// one pre-rendered "placeholder" page for any /app/datasets/<id>/ request;
// the real id is never known at build time, so DatasetDetailView (a client
// component) derives it from the live browser URL after hydration instead
// of trusting the statically-baked `params` value.
export function generateStaticParams() {
  return [{ id: 'placeholder' }]
}

export default function DatasetDetailPage() {
  return <DatasetDetailView />
}
