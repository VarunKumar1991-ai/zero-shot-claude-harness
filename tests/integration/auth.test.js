import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import bcrypt from "bcrypt";

/**
 * Integration test — hits the real Express app (src/index.js) and a real,
 * freshly-migrated SQLite DB (production driver, per architecture.md) with a
 * seeded test officer account. Runs migrations itself so this test is
 * self-sufficient regardless of whether `npm run migrate` has been run yet.
 */

const TEST_DB_PATH = path.resolve("data", "test-auth-integration.db");
const TEST_USERNAME = "test.officer";
const TEST_PASSWORD = "Test-Pass-123!";

let app;
let server;
let baseUrl;
let sequelizeInstance;

function extractCookie(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0]; // "session=<jwt>"
}

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  process.env.AGENT_DATABASE_URL = `sqlite:${TEST_DB_PATH.replace(/\\/g, "/")}`;
  process.env.AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || "test-secret-integration-auth-only";
  process.env.NODE_ENV = "test";

  execSync("npx sequelize-cli db:migrate", { stdio: "inherit", env: process.env });

  const dbModule = (await import("../../src/db/models/index.js")).default;
  sequelizeInstance = dbModule.sequelize;
  const { User } = dbModule;

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await User.create({ username: TEST_USERNAME, passwordHash, displayName: "Test Officer" });

  app = (await import("../../src/index.js")).default;
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}, 60000);

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (sequelizeInstance) {
    await sequelizeInstance.close();
  }
  try {
    // Best-effort cleanup — on Windows the sqlite file handle can briefly
    // remain locked immediately after sequelize.close(); the next test run's
    // beforeAll() removes it anyway, so a failure here must never fail the suite.
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    // ignore — see comment above
  }
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials, sets an httpOnly session cookie, and returns the officer (happy path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.username).toBe(TEST_USERNAME);
    expect(body.data.displayName).toBe("Test Officer");
    expect(typeof body.data.id).toBe("string");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("returns 400 when username or password is missing (edge case)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USERNAME }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 401 on an incorrect password (error path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USERNAME, password: "totally-wrong" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 401 for an unknown username (error path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "no.such.officer", password: "whatever" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 without a session cookie (error path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("returns 401 with a tampered cookie (error path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: "session=not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("returns the logged-in officer for a valid session cookie, matching real DB state (happy path)", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookie = extractCookie(loginRes);
    expect(cookie).toBeTruthy();

    const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);
    const body = await meRes.json();
    expect(body.data.username).toBe(TEST_USERNAME);
    expect(body.data.displayName).toBe("Test Officer");
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and returns loggedOut:true (happy path)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ loggedOut: true });
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("multi-interaction: login -> confirm session -> logout -> cleared cookie is issued for future requests", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const cookie = extractCookie(loginRes);

    const meBefore = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(meBefore.status).toBe(200);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const clearedCookie = logoutRes.headers.get("set-cookie");
    // Server instructs the client to drop the cookie (Max-Age=0 / past Expires).
    expect(clearedCookie).toMatch(/session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});
