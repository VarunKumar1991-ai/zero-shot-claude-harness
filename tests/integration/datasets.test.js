import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import bcrypt from "bcrypt";

/**
 * Integration test — hits the real Express app (src/index.js), a real,
 * freshly-migrated SQLite DB (production driver per architecture.md), and
 * real CSV fixtures on disk (never a stubbed parser). Runs migrations
 * itself so this test is self-sufficient regardless of run order.
 */

const TEST_DB_PATH = path.resolve("data", "test-datasets-integration.db");
const TEST_USERNAME = "test.dataset.officer";
const TEST_PASSWORD = "Test-Pass-456!";

const SMALL_FIXTURE = path.resolve("tests", "fixtures", "sample_fir_500rows.csv");

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

async function uploadFile(filePath, { name, excludeBadRows, cookie = sessionCookie, filename } = {}) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "text/csv" }), filename || path.basename(filePath));
  if (name !== undefined) form.append("name", name);
  if (excludeBadRows !== undefined) form.append("excludeBadRows", String(excludeBadRows));

  return fetch(`${baseUrl}/api/datasets`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
  });
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  process.env.AGENT_DATABASE_URL = `sqlite:${TEST_DB_PATH.replace(/\\/g, "/")}`;
  process.env.AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || "test-secret-integration-datasets-only";
  process.env.NODE_ENV = "test";

  execSync("npx sequelize-cli db:migrate", { stdio: "inherit", env: process.env });

  const dbModule = (await import("../../src/db/models/index.js")).default;
  sequelizeInstance = dbModule.sequelize;
  const { User } = dbModule;

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await User.create({ username: TEST_USERNAME, passwordHash, displayName: "Test Dataset Officer" });

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
}, 60000);

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

describe("POST /api/datasets — happy path", () => {
  it("uploads a real FIR CSV and returns a correct auto-generated profile, persisted to the real DB", async () => {
    const res = await uploadFile(SMALL_FIXTURE, { name: "June FIR export" });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.error).toBeNull();
    expect(typeof body.data.id).toBe("string");
    expect(body.data.name).toBe("June FIR export");
    expect(body.data.rowCount).toBe(500);

    const columnNames = body.data.columns.map((c) => c.name);
    expect(columnNames).toEqual([
      "case_number",
      "offence_type",
      "fir_date",
      "police_station",
      "district",
      "complainant_name",
      "status",
    ]);
    const firDateColumn = body.data.columns.find((c) => c.name === "fir_date");
    expect(firDateColumn.inferredType).toBe("date");

    // Real date range computed from the actual file's data.
    expect(body.data.dateRangeMin).toMatch(/^2025-\d{2}-\d{2}$/);
    expect(body.data.dateRangeMax).toMatch(/^2025-\d{2}-\d{2}$/);
    expect(body.data.dateRangeMin <= body.data.dateRangeMax).toBe(true);

    // Malformed rows surfaced as flags, never silently dropped.
    const totalFlagged = body.data.qualityFlags.reduce((sum, f) => sum + f.count, 0);
    expect(totalFlagged).toBeGreaterThanOrEqual(10);
    expect(totalFlagged).toBeLessThanOrEqual(20);
    expect(body.data.qualityFlags.every((f) => Array.isArray(f.sampleRowRefs))).toBe(true);

    // DB state assertion — the row really exists with the right shape.
    const dbModule = (await import("../../src/db/models/index.js")).default;
    const persisted = await dbModule.Dataset.findByPk(body.data.id);
    expect(persisted).not.toBeNull();
    expect(persisted.rowCount).toBe(500);
    expect(persisted.name).toBe("June FIR export");

    const persistedFile = await dbModule.DatasetFile.findOne({ where: { datasetId: body.data.id } });
    expect(persistedFile).not.toBeNull();
    expect(persistedFile.rowCount).toBe(500);
    expect(fs.existsSync(path.resolve(persistedFile.filePath))).toBe(true);
  });
});

describe("POST /api/datasets — edge case: excludeBadRows", () => {
  it("excludes flagged malformed rows from the persisted row count on a confirmed re-submit", async () => {
    const firstRes = await uploadFile(SMALL_FIXTURE, { name: "Unfiltered upload" });
    const firstBody = await firstRes.json();
    const totalFlagged = firstBody.data.qualityFlags.reduce((sum, f) => sum + f.count, 0);

    const secondRes = await uploadFile(SMALL_FIXTURE, { name: "Filtered upload", excludeBadRows: true });
    expect(secondRes.status).toBe(201);
    const secondBody = await secondRes.json();

    // Fewer rows than the unfiltered upload — bad rows were actually excluded.
    expect(secondBody.data.rowCount).toBeLessThan(firstBody.data.rowCount);
    expect(secondBody.data.rowCount).toBe(500 - totalFlagged);
  });
});

describe("POST /api/datasets — error paths", () => {
  it("returns 400 when no file is attached", async () => {
    const form = new FormData();
    form.append("name", "No file here");
    const res = await fetch(`${baseUrl}/api/datasets`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 401 when not logged in", async () => {
    const res = await uploadFile(SMALL_FIXTURE, { cookie: null });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("returns 400 for an empty CSV (header only, no data rows)", async () => {
    const form = new FormData();
    form.append("file", new Blob(["case_number,offence_type\n"], { type: "text/csv" }), "empty.csv");
    const res = await fetch(`${baseUrl}/api/datasets`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("returns 413 when the file exceeds the 500MB limit", async () => {
    // Build a >500MB buffer cheaply (repeated valid CSV lines) rather than
    // asserting against a real ~500MB fixture, to keep the suite fast.
    const header = "case_number,offence_type,fir_date\n";
    const row = "FIR/000000,Theft,2025-06-01\n";
    const rowsNeeded = Math.ceil((501 * 1024 * 1024) / row.length);
    const oversized = Buffer.concat([Buffer.from(header), Buffer.from(row.repeat(rowsNeeded))]);

    const form = new FormData();
    form.append("file", new Blob([oversized], { type: "text/csv" }), "oversized.csv");
    const res = await fetch(`${baseUrl}/api/datasets`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
      body: form,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("file_too_large");
  }, 30000);
});

describe("GET /api/datasets and GET /api/datasets/:id/profile — state survival", () => {
  it("multi-interaction: an uploaded dataset is listed and its profile is re-fetchable in a later, independent request", async () => {
    const uploadRes = await uploadFile(SMALL_FIXTURE, { name: "Listed dataset" });
    const uploadBody = await uploadRes.json();
    const datasetId = uploadBody.data.id;

    // Second, independent interaction — simulates re-opening the dataset later.
    const listRes = await fetch(`${baseUrl}/api/datasets`, { headers: { Cookie: sessionCookie } });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.error).toBeNull();
    const found = listBody.data.find((d) => d.id === datasetId);
    expect(found).toBeDefined();
    expect(found.rowCount).toBe(500);

    const profileRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/profile`, {
      headers: { Cookie: sessionCookie },
    });
    expect(profileRes.status).toBe(200);
    const profileBody = await profileRes.json();
    expect(profileBody.data).toEqual(uploadBody.data);
  });

  it("returns 404 for an unknown dataset id (error path)", async () => {
    const res = await fetch(`${baseUrl}/api/datasets/00000000-0000-0000-0000-000000000000/profile`, {
      headers: { Cookie: sessionCookie },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 for the profile route when not logged in", async () => {
    const res = await fetch(`${baseUrl}/api/datasets/00000000-0000-0000-0000-000000000000/profile`);
    expect(res.status).toBe(401);
  });
});
