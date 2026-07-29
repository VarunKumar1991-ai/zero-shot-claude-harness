import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

// Loaded explicitly (rather than relying on src/index.js's own
// `require("dotenv").config()`) because HAS_KEY is evaluated at module
// scope below, before that module is ever imported.
dotenv.config();

/**
 * Integration test — hits the real Express app (src/index.js), a real,
 * freshly-migrated SQLite DB (production driver per architecture.md), the
 * real CSV fixtures on disk, and the REAL Gemini API via
 * AGENT_GEMINI_API_KEY from .env (no LLM mocking). Real-key tests are
 * skipped (not muted-green) when the key is absent from the environment.
 *
 * This is the anti-sampling proof for the whole Phase-1 data-processing
 * gate: the large-fixture test asserts the agent's returned count exactly
 * matches tests/fixtures/large_fir_50000rows.meta.json's pre-computed value,
 * which is only possible via real full-dataset code execution (52,000 rows
 * is far beyond any plausible LLM-prompt sample size).
 */

const TEST_DB_PATH = path.resolve("data", "test-queries-integration.db");
const TEST_USERNAME = "test.queries.officer";
const TEST_PASSWORD = "Test-Pass-789!";

const SMALL_FIXTURE = path.resolve("tests", "fixtures", "sample_fir_500rows.csv");
const LARGE_FIXTURE = path.resolve("tests", "fixtures", "large_fir_50000rows.csv");
const LARGE_META = JSON.parse(
  fs.readFileSync(path.resolve("tests", "fixtures", "large_fir_50000rows.meta.json"), "utf8")
);

const HAS_KEY = Boolean(process.env.AGENT_GEMINI_API_KEY);

let app;
let server;
let baseUrl;
let sequelizeInstance;
let sessionCookie;

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0];
}

async function uploadFile(filePath, { name } = {}) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "text/csv" }), path.basename(filePath));
  if (name !== undefined) form.append("name", name);

  return fetch(`${baseUrl}/api/datasets`, {
    method: "POST",
    headers: { Cookie: sessionCookie },
    body: form,
  });
}

async function askQuestion(datasetId, question, { cookie = sessionCookie, sessionId = "queries-test-session" } = {}) {
  return fetch(`${baseUrl}/api/datasets/${datasetId}/queries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ question, sessionId }),
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  process.env.AGENT_DATABASE_URL = `sqlite:${TEST_DB_PATH.replace(/\\/g, "/")}`;
  process.env.AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || "test-secret-integration-queries-only";
  process.env.NODE_ENV = "test";

  execSync("npx sequelize-cli db:migrate", { stdio: "inherit", env: process.env });

  const dbModule = (await import("../../src/db/models/index.js")).default;
  sequelizeInstance = dbModule.sequelize;
  const { User } = dbModule;

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await User.create({ username: TEST_USERNAME, passwordHash, displayName: "Test Queries Officer" });

  app = (await import("../../src/index.js")).default;
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  sessionCookie = extractCookie(loginRes);
  expect(sessionCookie).toBeTruthy();

  if (!HAS_KEY) {
    // eslint-disable-next-line no-console
    console.warn("AGENT_GEMINI_API_KEY not set in .env — skipping real-LLM queries integration tests");
  }
}, 120000);

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (sequelizeInstance) {
    await sequelizeInstance.close();
  }
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    // best-effort — see auth.test.js for rationale
  }
});

describe.skipIf(!HAS_KEY)("POST /api/datasets/:id/queries — happy path (real Gemini + real DB)", () => {
  it(
    "answers a real question against the uploaded small fixture with the correct count, visible code, and a persisted audit row",
    async () => {
      const uploadRes = await uploadFile(SMALL_FIXTURE, { name: "Queries happy-path FIR" });
      expect(uploadRes.status).toBe(201);
      const uploadBody = await uploadRes.json();
      const datasetId = uploadBody.data.id;

      // Ground truth from the real fixture: Theft rows with fir_date in 2025-06.
      const rows = fs.readFileSync(SMALL_FIXTURE, "utf8").split("\n").slice(1).filter(Boolean);
      const expectedCount = rows.filter((line) => {
        const cols = line.split(",");
        return cols[1] === "Theft" && cols[2] && cols[2].startsWith("2025-06");
      }).length;
      expect(expectedCount).toBeGreaterThan(0);

      const res = await askQuestion(datasetId, "How many thefts were reported in June 2025?");
      expect(res.status).toBe(200);
      const body = await res.json();

      // eslint-disable-next-line no-console
      console.log("\n--- queries.test.js happy path ---");
      // eslint-disable-next-line no-console
      console.log("answer:", body.data.answer);
      // eslint-disable-next-line no-console
      console.log("generatedCode:\n", body.data.generatedCode);

      expect(body.error).toBeNull();
      expect(body.data.status).toBe("completed");
      expect(body.data.answer).toContain(String(expectedCount));
      expect(typeof body.data.generatedCode).toBe("string");
      expect(body.data.generatedCode.length).toBeGreaterThan(0);
      expect(body.data.attempts.length).toBeGreaterThan(0);
      expect(body.data.tokenUsage.promptTokens).toBeGreaterThan(0);

      // DB state assertion — the audit row really exists.
      const dbModule = (await import("../../src/db/models/index.js")).default;
      const persisted = await dbModule.Query.findByPk(body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted.datasetId).toBe(datasetId);
      expect(persisted.question).toBe("How many thefts were reported in June 2025?");
      expect(persisted.status).toBe("completed");
      expect(persisted.generatedCode).toBeTruthy();
    },
    60000
  );

  it("history endpoint returns the just-asked question, most recent first (multi-interaction)", async () => {
    const uploadRes = await uploadFile(SMALL_FIXTURE, { name: "Queries history FIR" });
    const uploadBody = await uploadRes.json();
    const datasetId = uploadBody.data.id;

    const askRes = await askQuestion(datasetId, "How many records are there in total?");
    expect(askRes.status).toBe(200);

    // Second, independent interaction.
    const historyRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/queries`, {
      headers: { Cookie: sessionCookie },
    });
    expect(historyRes.status).toBe(200);
    const historyBody = await historyRes.json();
    expect(historyBody.error).toBeNull();
    expect(historyBody.data.length).toBeGreaterThanOrEqual(1);
    expect(historyBody.data[0].question).toBe("How many records are there in total?");
    expect(historyBody.data[0].status).toBe("completed");
  }, 60000);
});

describe("POST /api/datasets/:id/queries — error paths (no LLM call required)", () => {
  it("returns 400 for a missing/empty question", async () => {
    const uploadRes = await uploadFile(SMALL_FIXTURE, { name: "Empty question dataset" });
    const uploadBody = await uploadRes.json();

    const res = await askQuestion(uploadBody.data.id, "   ");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 404 for an unknown dataset id", async () => {
    const res = await askQuestion("00000000-0000-0000-0000-000000000000", "How many thefts were there?");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 when not logged in", async () => {
    const uploadRes = await uploadFile(SMALL_FIXTURE, { name: "Unauth question dataset" });
    const uploadBody = await uploadRes.json();

    const res = await askQuestion(uploadBody.data.id, "How many thefts were there?", { cookie: null });
    expect(res.status).toBe(401);
  });

  it("returns 401 for the history route when not logged in", async () => {
    const res = await fetch(`${baseUrl}/api/datasets/00000000-0000-0000-0000-000000000000/queries`);
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!HAS_KEY)("POST /api/datasets/:id/queries — anti-sampling gate: 52,000-row fixture", () => {
  it(
    "returns the exact pre-computed count for a specific offence-type/month via real full-dataset code execution, never a sampled/guessed number",
    async () => {
      const uploadRes = await uploadFile(LARGE_FIXTURE, { name: "Large FIR anti-sampling fixture" });
      expect(uploadRes.status).toBe(201);
      const uploadBody = await uploadRes.json();
      expect(uploadBody.data.rowCount).toBe(LARGE_META.totalRows);
      const datasetId = uploadBody.data.id;

      const question = `How many ${LARGE_META.offenceType} cases were reported in ${LARGE_META.monthName} ${LARGE_META.year}?`;
      const res = await askQuestion(datasetId, question);
      expect(res.status).toBe(200);
      const body = await res.json();

      // eslint-disable-next-line no-console
      console.log("\n--- queries.test.js anti-sampling 52k-row gate ---");
      // eslint-disable-next-line no-console
      console.log("question:", question);
      // eslint-disable-next-line no-console
      console.log("answer:", body.data.answer);
      // eslint-disable-next-line no-console
      console.log("generatedCode:\n", body.data.generatedCode);
      // eslint-disable-next-line no-console
      console.log("expectedCount:", LARGE_META.expectedCount);

      expect(body.error).toBeNull();
      expect(body.data.status).toBe("completed");

      const lastAttempt = body.data.attempts[body.data.attempts.length - 1];
      expect(lastAttempt.executionResult.error).toBeNull();
      // The binding anti-sampling assertion: the real-code-executed result
      // must exactly match the pre-computed known-correct value.
      expect(lastAttempt.executionResult.result).toBe(LARGE_META.expectedCount);
      // Plain-language answers may thousands-comma-format the number (e.g.
      // "1,347") — tolerate that formatting while still requiring the exact
      // figure to appear (never a rounded/approximate value).
      const answerNoCommas = body.data.answer.replace(/,/g, "");
      expect(answerNoCommas).toContain(String(LARGE_META.expectedCount));

      const dbModule = (await import("../../src/db/models/index.js")).default;
      const persisted = await dbModule.Query.findByPk(body.data.id);
      expect(persisted).not.toBeNull();
      expect(persisted.generatedCode).toBeTruthy();
      // The audit trail's own attempt log carries the same exact-match
      // computed value regardless of whether the (separate) prose-synthesis
      // LLM call itself later succeeded or hit a transient provider outage —
      // this is the load-bearing anti-sampling proof for the persisted row.
      const persistedAttempts = persisted.attempts || [];
      const persistedLastAttempt = persistedAttempts[persistedAttempts.length - 1];
      expect(persistedLastAttempt.executionResult.result).toBe(LARGE_META.expectedCount);
    },
    90000
  );
});
