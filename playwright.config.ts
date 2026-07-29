import { defineConfig, devices } from '@playwright/test'

// The frontend is a Next.js static export mounted by the Express backend at
// /app on the same origin as the API (:8001) — see spec/architecture.md's
// single-origin rule. The full Phase 1 journey (login -> upload -> profile
// -> ask -> answer) needs the real backend running, so this config does not
// start its own webServer — the gate command starts the backend explicitly
// (`npm run dev`, the only long-running server) and produces the static
// frontend export (`cd frontend && npm run build`, one-time, output in
// `frontend/out/`, served by the backend at `/app` — no separate frontend
// server/port) before invoking Playwright, per the roadmap's handoff
// instructions.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
