import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NOTE on mocking strategy: this is a CommonJS (package.json "type":
// "commonjs") codebase. Vitest's `vi.mock` intercepts ESM `import`/`export`
// module graphs; it does NOT intercept a nested `require()` call made from
// inside another CJS file (verified empirically — vi.mock silently no-ops
// for pure-CJS nested requires in this project, and even a plain ESM
// `import` of a CJS module can land on a different module-registry entry
// than a CJS file's internal `require()` of that same path). Node's native
// `require()` cache IS shared and singleton when EVERY reference in the
// chain — the dependency, the node module under test, AND the test file's
// own reference — is obtained via `require()` (not `import`). Nodes call
// `geminiClient.generateJSON(...)` via a live property lookup on the shared
// module object (never destructured at require-time — see
// src/agent/nodes/*.js) and these tests monkeypatch that same shared object
// directly via `require()`, restoring the original in `afterEach`.
const geminiClient = require("../../../src/llm/geminiClient.js");
const { classify } = require("../../../src/agent/nodes/classify.js");
const { plan } = require("../../../src/agent/nodes/plan.js");
const { generateCode } = require("../../../src/agent/nodes/generateCode.js");
const { executeCode } = require("../../../src/agent/nodes/executeCode.js");
const { inspectResult, fastPathVerdict } = require("../../../src/agent/nodes/inspectResult.js");
const { synthesizeAnswer } = require("../../../src/agent/nodes/synthesizeAnswer.js");
const { suggestFollowups } = require("../../../src/agent/nodes/suggestFollowups.js");
const { handleError } = require("../../../src/agent/nodes/handleError.js");
const { finalize } = require("../../../src/agent/nodes/finalize.js");
const { loadContext } = require("../../../src/agent/nodes/loadContext.js");

const originalGenerateJSON = geminiClient.generateJSON;

const baseState = () => ({
  question: "How many thefts were reported in June?",
  datasetProfile: { columns: ["offenceType", "date"], rowCount: 100, dateRange: ["2024-01-01", "2024-12-31"] },
  sampleRows: [{ offenceType: "theft", date: "2024-06-01" }],
  rows: [{ offenceType: "theft", date: "2024-06-01" }],
  attempts: [],
  retryCount: 0,
  tokenUsage: { promptTokens: 0, completionTokens: 0 },
});

let mockGenerateJSON;

beforeEach(() => {
  mockGenerateJSON = vi.fn();
  geminiClient.generateJSON = mockGenerateJSON;
});

afterEach(() => {
  geminiClient.generateJSON = originalGenerateJSON;
});

describe("load_context node", () => {
  it("derives a <=20-row sample and passes through profile/rows", async () => {
    const manyRows = Array.from({ length: 30 }, (_, i) => ({ id: i }));
    const result = await loadContext({ rows: manyRows, columns: ["id"], datasetProfile: { columns: ["id"], rowCount: 30 } });
    expect(result.sampleRows.length).toBe(20);
    expect(result.rows.length).toBe(30);
    expect(result.error).toBeUndefined();
  });

  it("sets an error when datasetProfile is missing (edge case)", async () => {
    const result = await loadContext({ rows: [], columns: [] });
    expect(result.error).toMatch(/datasetProfile/);
  });
});

describe("classify node", () => {
  it("routes a simple question to complexity=simple (happy path)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { complexity: "simple" },
      model: "gemini-2.5-flash",
      tokenUsage: { promptTokens: 10, completionTokens: 2 },
    });
    const result = await classify(baseState());
    expect(result.complexity).toBe("simple");
    expect(result.clarifyingQuestion).toBeNull();
    expect(result.tokenUsage.promptTokens).toBe(10);
  });

  it("routes an ambiguous question to needs_clarification with a clarifying question (edge case)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { complexity: "needs_clarification", clarifyingQuestion: "What do you mean by 'bad cases'?" },
      model: "gemini-2.5-flash",
      tokenUsage: { promptTokens: 8, completionTokens: 4 },
    });
    const result = await classify({ ...baseState(), question: "how many bad cases were there" });
    expect(result.complexity).toBe("needs_clarification");
    expect(result.clarifyingQuestion).toBe("What do you mean by 'bad cases'?");
  });

  it("sets error=llm_unavailable when the LLM call fails after retries (error path)", async () => {
    const err = new Error("llm_unavailable: exhausted retries");
    err.code = "llm_unavailable";
    mockGenerateJSON.mockRejectedValue(err);
    const result = await classify(baseState());
    expect(result.error).toBe("llm_unavailable");
  });
});

describe("plan node", () => {
  it("no-ops with an empty planSteps for non-complex complexity", async () => {
    const result = await plan({ ...baseState(), complexity: "simple" });
    expect(result.planSteps).toEqual([]);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it("produces an ordered plan for complex questions (happy path)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { steps: ["Filter to theft", "Group by month", "Count per group"] },
      model: "gemini-3.1-pro",
      tokenUsage: { promptTokens: 12, completionTokens: 6 },
    });
    const result = await plan({ ...baseState(), complexity: "complex" });
    expect(result.planSteps).toHaveLength(3);
  });
});

describe("generate_code node", () => {
  it("produces code + explanation and does not increment retryCount on first attempt (happy path)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { code: "result = rows.length;", explanation: "count all rows" },
      model: "gemini-3.1-pro",
      tokenUsage: { promptTokens: 20, completionTokens: 10 },
    });
    const result = await generateCode(baseState());
    expect(result.generatedCode).toBe("result = rows.length;");
    expect(result.retryCount).toBe(0);
  });

  it("increments retryCount when there is a prior failed attempt (retry path)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { code: "result = rows.length;", explanation: "retry" },
      model: "gemini-3.1-pro",
      tokenUsage: { promptTokens: 20, completionTokens: 10 },
    });
    const state = {
      ...baseState(),
      attempts: [{ code: "bad code", executionResult: { error: "ReferenceError: x is not defined" } }],
      retryCount: 0,
    };
    const result = await generateCode(state);
    expect(result.retryCount).toBe(1);
  });

  it("returns an error without throwing when the LLM call fails (error path)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("503 overloaded"));
    const result = await generateCode(baseState());
    expect(result.error).toMatch(/llm_unavailable/);
    expect(result.generatedCode).toBe("");
  });
});

describe("execute_code node", () => {
  it("runs generated code in the real sandbox and appends an attempt (happy path)", async () => {
    const state = {
      ...baseState(),
      generatedCode: 'result = rows.filter(r => r.offenceType === "theft").length;',
      rows: [{ offenceType: "theft" }, { offenceType: "theft" }, { offenceType: "assault" }],
    };
    const result = await executeCode(state);
    expect(result.executionResult.result).toBe(2);
    expect(result.executionResult.error).toBeNull();
    expect(result.attempts).toHaveLength(1);
  });

  it("handles missing generated code gracefully without invoking the sandbox (edge case)", async () => {
    const result = await executeCode({ ...baseState(), generatedCode: "" });
    expect(result.executionResult.error).toMatch(/no code/);
    expect(result.attempts).toHaveLength(1);
  });
});

describe("inspect_result node", () => {
  it("fast-paths a clean numeric result to ok without an LLM call", () => {
    const verdict = fastPathVerdict({ result: 42, error: null });
    expect(verdict.verdict).toBe("ok");
  });

  it("does not fast-path an execution error, and asks the LLM instead", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { verdict: "retry", note: "execution failed" },
      model: "gemini-2.5-flash",
      tokenUsage: { promptTokens: 5, completionTokens: 3 },
    });
    const result = await inspectResult({
      ...baseState(),
      executionResult: { result: undefined, error: "ReferenceError: x is not defined" },
    });
    expect(result.inspectionVerdict).toBe("retry");
    expect(mockGenerateJSON).toHaveBeenCalled();
  });

  it("degrades to give_up (never throws) when the inspection LLM call itself fails (error path)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("network error"));
    const result = await inspectResult({
      ...baseState(),
      executionResult: { result: { weird: "shape" }, error: null },
    });
    expect(result.inspectionVerdict).toBe("give_up");
  });
});

describe("synthesize_answer node", () => {
  it("produces an answer with key numbers and no assumptions on a clean result (happy path)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { answer: "There were 42 thefts.", keyNumbers: [{ label: "Thefts", value: "42" }], assumptions: [] },
      model: "gemini-3.1-pro",
      tokenUsage: { promptTokens: 15, completionTokens: 8 },
    });
    const result = await synthesizeAnswer({
      ...baseState(),
      executionResult: { result: 42, error: null },
      inspectionVerdict: "ok",
    });
    expect(result.answer).toContain("42");
    expect(result.assumptions).toEqual([]);
  });

  it("flags an assumption when inspection verdict was not ok (edge case)", async () => {
    mockGenerateJSON.mockResolvedValue({
      data: { answer: "Best guess: about 42 thefts.", keyNumbers: [], assumptions: [] },
      model: "gemini-3.1-pro",
      tokenUsage: { promptTokens: 15, completionTokens: 8 },
    });
    const result = await synthesizeAnswer({
      ...baseState(),
      executionResult: { result: 42, error: null },
      inspectionVerdict: "give_up",
      inspectionNote: "could not fully verify",
    });
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("never fabricates an answer on LLM failure — returns a clear fallback (error path)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("503"));
    const result = await synthesizeAnswer({ ...baseState(), executionResult: { result: 42, error: null } });
    expect(result.answer).toMatch(/temporarily unavailable/i);
    expect(result.error).toMatch(/llm_unavailable/);
  });
});

describe("suggest_followups node (Phase 1 structural stub)", () => {
  it("always returns an empty array without calling the LLM", async () => {
    const result = await suggestFollowups(baseState());
    expect(result.followups).toEqual([]);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });
});

describe("handle_error node", () => {
  it("returns a plain-language message and status=failed, never a raw stack trace", async () => {
    const result = await handleError({ error: "llm_unavailable: exhausted retries" });
    expect(result.status).toBe("failed");
    expect(result.answer).not.toMatch(/Error:|at /); // no stack-trace-looking text
  });
});

describe("finalize node", () => {
  it("marks status=completed for a normal run", async () => {
    const result = await finalize({ complexity: "simple" });
    expect(result.status).toBe("completed");
  });

  it("keeps status=needs_clarification when classify routed straight here", async () => {
    const result = await finalize({ complexity: "needs_clarification" });
    expect(result.status).toBe("needs_clarification");
  });
});
