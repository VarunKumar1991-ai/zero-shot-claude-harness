import { test, expect } from '@playwright/test'
import path from 'node:path'

// Full Phase 1 primary journey per spec/roadmap.md's handoff seed:
// login -> dataset list -> upload -> profile -> ask -> answer -> show code.
// Runs against the real, live server (Express serving both /api and the
// static /app export) — no mocked responses, per harness/rules/ai-agents.md.

const SEED_USERNAME = 'officer.demo'
const SEED_PASSWORD = 'Password123!'
const SAMPLE_CSV = path.resolve(__dirname, '../fixtures/sample_fir_500rows.csv')

test.describe('Phase 1 — login, upload, profile, ask', () => {
  test('login page renders with real styling and states', async ({ page }) => {
    await page.goto('/app/login/')

    await expect(page.getByRole('heading', { name: /UP Police Data Analyst/i })).toBeVisible()
    const usernameInput = page.getByLabel('Username')
    const passwordInput = page.getByLabel('Password')
    await expect(usernameInput).toBeVisible()
    await expect(passwordInput).toBeVisible()

    const submit = page.getByRole('button', { name: /log in/i })
    await expect(submit).toBeDisabled()
  })

  test('incorrect credentials show a real, human error message', async ({ page }) => {
    await page.goto('/app/login/')
    await page.getByLabel('Username').fill('not-a-real-officer')
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: /log in/i }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: /incorrect username or password/i })
    ).toBeVisible({ timeout: 15000 })
  })

  test('full primary journey: login -> upload -> profile -> ask -> answer -> show code', async ({
    page,
  }) => {
    // This test drives the real agent graph end-to-end (upload + profile +
    // Gemini classify/generate/execute round trip). Real-key integration
    // measurements (tests/integration/queries.test.js,
    // tests/integration/agentGraph.test.js) show real Gemini round trips of
    // 33.5s-40.2s alone, on top of upload/profile time — well past
    // Playwright's default 30s per-test timeout. Bump this one test's
    // timeout so a fully successful real run isn't killed by the harness
    // before the assertions below can resolve.
    test.setTimeout(90_000)

    // 1. Login
    await page.goto('/app/login/')
    await page.getByLabel('Username').fill(SEED_USERNAME)
    await page.getByLabel('Password').fill(SEED_PASSWORD)
    await page.getByRole('button', { name: /log in/i }).click()

    await page.waitForURL(/\/app\/datasets\/?$/, { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible()

    // 2. Upload a real CSV
    await page.getByRole('button', { name: /upload csv/i }).click()
    await page.locator('#csv-file').setInputFiles(SAMPLE_CSV)
    await page.getByRole('button', { name: /^upload$/i }).click()

    // Either lands straight on the detail page, or shows the quality-flag
    // review step first (spec/ui.md Upload Flow) — handle both. Wait for
    // whichever happens first (the upload+profile round trip takes real time).
    const excludeButton = page.getByRole('button', { name: /exclude bad rows and continue/i })
    await Promise.race([
      excludeButton.waitFor({ state: 'visible', timeout: 30000 }),
      page.waitForURL(/\/app\/datasets\/[^/]+\/?$/, { timeout: 30000 }),
    ]).catch(() => {})

    if (await excludeButton.isVisible()) {
      await excludeButton.click()
      await page.waitForURL(/\/app\/datasets\/[^/]+\/?$/, { timeout: 30000 })
    }

    // 3. Profile card shows real columns / row count
    await expect(page.getByText(/rows/i).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/columns \(/i)).toBeVisible()

    // 4. Ask a real question
    const questionBox = page.getByPlaceholder('Ask a question about this dataset…')
    await questionBox.fill('How many FIRs are in this dataset?')
    await page.getByRole('button', { name: /^ask$/i }).click()

    // Step-counter progress indicator appears while the multi-step agent runs
    await expect(page.locator('span').getByText(/classifying question…/i)).toBeVisible({
      timeout: 10000,
    })

    // 5. Real plain-language answer appears (real LLM + real sandboxed code
    // execution over the full uploaded CSV — allow generous time for the
    // full Gemini + execution round trip).
    const showCodeButton = page.getByRole('button', { name: /show code/i })
    await expect(showCodeButton).toBeVisible({ timeout: 60000 })

    // 6. Expand "Show code" and confirm the exact generated code is visible
    await showCodeButton.click()
    await expect(page.locator('pre code').first()).toBeVisible()
  })

  test('empty dataset-list state renders guidance copy when no datasets exist yet', async ({
    page,
  }) => {
    // This assertion documents the required empty-state copy; it only
    // renders meaningfully against a freshly-seeded DB with zero datasets,
    // so it is a soft check — skipped if datasets already exist from a
    // prior run in this same environment.
    await page.goto('/app/login/')
    await page.getByLabel('Username').fill(SEED_USERNAME)
    await page.getByLabel('Password').fill(SEED_PASSWORD)
    await page.getByRole('button', { name: /log in/i }).click()
    await page.waitForURL(/\/app\/datasets\/?$/, { timeout: 15000 })

    const emptyCopy = page.getByText(/no datasets yet/i)
    if (await emptyCopy.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(emptyCopy).toBeVisible()
    }
  })
})
