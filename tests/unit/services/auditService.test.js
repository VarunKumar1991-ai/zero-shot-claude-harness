import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * Unit test for src/services/auditService.js — exercises the real Sequelize
 * `Query` model against a real, freshly-migrated SQLite DB (production
 * driver per architecture.md; no mocked ORM). No LLM calls here — the
 * `graphResult` inputs are hand-built objects shaped like runAgentGraph's
 * real return contract (see src/agent/graph.js's JSDoc), which is the unit
 * this service is contractually bound to, not a live agent run (that's
 * covered by tests/integration/queries.test.js).
 */

const TEST_DB_PATH = path.resolve("data", "test-auditservice-unit.db");

let db;
let recordQuery;
let listQueries;
let datasetId;
let userId;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  process.env.AGENT_DATABASE_URL = `sqlite:${TEST_DB_PATH.replace(/\\/g, "/")}`;
  process.env.AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || "test-secret-auditservice-unit-only";
  process.env.NODE_ENV = "test";

  execSync("npx sequelize-cli db:migrate", { stdio: "inherit", env: process.env });

  db = (await import("../../../src/db/models/index.js")).default;
  ({ recordQuery, listQueries } = await import("../../../src/services/auditService.js"));

  const user = await db.User.create({
    username: `audit.unit.${randomUUID()}`,
    passwordHash: "not-a-real-hash",
    displayName: "Audit Unit Test Officer",
  });
  userId = user.id;

  const dataset = await db.Dataset.create({
    name: "Audit unit test dataset",
    createdByUserId: userId,
    rowCount: 10,
    columns: [{ name: "offence_type", inferredType: "string" }],
    qualityFlags: [],
  });
  datasetId = dataset.id;
}, 60000);

afterAll(async () => {
  if (db && db.sequelize) {
    await db.sequelize.close();
  }
  try {
    fs.rmSync(TEST_DB_PATH, { force: true });
  } catch {
    // best-effort — Windows can briefly hold the file handle
  }
});

describe("auditService.recordQuery — happy path", () => {
  it("persists a completed run's full audit trail (question, code, result, tokens, timestamps)", async () => {
    const runId = randomUUID();
    const createdAt = new Date("2026-01-01T10:00:00.000Z");
    const completedAt = new Date("2026-01-01T10:00:12.000Z");

    const graphResult = {
      status: "completed",
      answer: "There were 4 thefts reported in June.",
      keyNumbers: [{ label: "Thefts in June", value: 4 }],
      assumptions: [],
      clarifyingQuestion: null,
      code: "result = rows.filter(r => r.offence_type === 'Theft').length;",
      steps: [
        {
          code: "result = rows.filter(r => r.offence_type === 'Theft').length;",
          explanation: "Count theft rows.",
          executionResult: { result: 4, error: null, durationMs: 3 },
          inspection: "ok",
        },
      ],
      followups: [],
      complexity: "simple",
      retryCount: 0,
      tokenUsage: { promptTokens: 500, completionTokens: 80 },
      error: null,
    };

    const created = await recordQuery({
      id: runId,
      datasetId,
      userId,
      sessionId: "session-happy-path",
      question: "How many thefts were reported in June?",
      graphResult,
      createdAt,
      completedAt,
    });

    expect(created.id).toBe(runId);

    const persisted = await db.Query.findByPk(runId);
    expect(persisted).not.toBeNull();
    expect(persisted.datasetId).toBe(datasetId);
    expect(persisted.userId).toBe(userId);
    expect(persisted.question).toBe("How many thefts were reported in June?");
    expect(persisted.status).toBe("completed");
    expect(persisted.answer).toBe(graphResult.answer);
    expect(persisted.generatedCode).toBe(graphResult.code);
    expect(persisted.attempts).toHaveLength(1);
    expect(persisted.keyNumbers).toEqual(graphResult.keyNumbers);
    expect(persisted.tokenUsage).toEqual(graphResult.tokenUsage);
    expect(new Date(persisted.createdAt).toISOString()).toBe(createdAt.toISOString());
    expect(new Date(persisted.completedAt).toISOString()).toBe(completedAt.toISOString());
  });
});

describe("auditService.recordQuery — edge case: needs_clarification (no answer/result)", () => {
  it("persists a clarification turn with null answer/result and empty keyNumbers", async () => {
    const runId = randomUUID();
    const graphResult = {
      status: "needs_clarification",
      answer: null,
      keyNumbers: [],
      assumptions: [],
      clarifyingQuestion: "Which district's cases do you mean?",
      code: null,
      steps: [],
      followups: [],
      complexity: "needs_clarification",
      retryCount: 0,
      tokenUsage: { promptTokens: 300, completionTokens: 40 },
      error: null,
    };

    await recordQuery({
      id: runId,
      datasetId,
      userId,
      sessionId: "session-clarification",
      question: "How many bad cases were there?",
      graphResult,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const persisted = await db.Query.findByPk(runId);
    expect(persisted.status).toBe("needs_clarification");
    expect(persisted.answer).toBeNull();
    expect(persisted.generatedCode).toBeNull();
    expect(persisted.result).toBeNull();
    expect(persisted.keyNumbers).toEqual([]);
  });
});

describe("auditService.recordQuery — error path: failed run", () => {
  it("persists a failed run with its error message and never fabricates an answer", async () => {
    const runId = randomUUID();
    const graphResult = {
      status: "failed",
      answer: null,
      keyNumbers: [],
      assumptions: [],
      clarifyingQuestion: null,
      code: null,
      steps: [],
      followups: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0 },
      error: "llm_unavailable: exhausted retries",
    };

    await recordQuery({
      id: runId,
      datasetId,
      userId,
      sessionId: "session-failed",
      question: "How many thefts were reported in June?",
      graphResult,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const persisted = await db.Query.findByPk(runId);
    expect(persisted.status).toBe("failed");
    expect(persisted.answer).toBeNull();
    expect(persisted.error).toBe("llm_unavailable: exhausted retries");
  });
});

describe("auditService.listQueries — multi-interaction + state survival", () => {
  it("returns a dataset's queries most-recent-first, surviving across separate calls", async () => {
    const earlier = randomUUID();
    const later = randomUUID();

    await recordQuery({
      id: earlier,
      datasetId,
      userId,
      sessionId: "session-list",
      question: "First question",
      graphResult: {
        status: "completed",
        answer: "First answer",
        keyNumbers: [],
        assumptions: [],
        clarifyingQuestion: null,
        code: "result = 1;",
        steps: [],
        followups: [],
        tokenUsage: { promptTokens: 1, completionTokens: 1 },
        error: null,
      },
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
      completedAt: new Date("2026-01-01T09:00:05.000Z"),
    });

    await recordQuery({
      id: later,
      datasetId,
      userId,
      sessionId: "session-list",
      question: "Second question",
      graphResult: {
        status: "completed",
        answer: "Second answer",
        keyNumbers: [],
        assumptions: [],
        clarifyingQuestion: null,
        code: "result = 2;",
        steps: [],
        followups: [],
        tokenUsage: { promptTokens: 1, completionTokens: 1 },
        error: null,
      },
      createdAt: new Date("2026-01-01T09:05:00.000Z"),
      completedAt: new Date("2026-01-01T09:05:05.000Z"),
    });

    // Independent, later call — proves persistence survives across
    // separate service invocations, not just in-process state.
    const list = await listQueries(datasetId);
    const ids = list.map((q) => q.id);
    expect(ids.indexOf(later)).toBeLessThan(ids.indexOf(earlier));
    expect(list.find((q) => q.id === earlier).question).toBe("First question");
    expect(list.find((q) => q.id === later).question).toBe("Second question");
  });
});
