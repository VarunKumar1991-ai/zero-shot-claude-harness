import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NOTE on mocking strategy: see tests/unit/agent/nodes.test.js for the full
// rationale — this is a CommonJS codebase, so we monkeypatch the shared
// geminiClient module object obtained via require() (never destructured at
// require-time inside src/agent/nodes/generateCode.js), restoring the
// original in afterEach.
const geminiClient = require("../../../src/llm/geminiClient.js");
const { generateCode } = require("../../../src/agent/nodes/generateCode.js");
const { MAX_CODE_RETRIES } = require("../../../src/agent/constants.js");

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

describe("generate_code node — LLM-failure retryCount bookkeeping (bug regression)", () => {
  it("does not increment retryCount on a first-attempt LLM failure (happy/edge baseline)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("503 overloaded"));
    const result = await generateCode(baseState());
    expect(result.error).toMatch(/llm_unavailable/);
    expect(result.generatedCode).toBe("");
    expect(result.retryCount).toBe(0);
  });

  it("increments retryCount across repeated LLM failures, matching the success-path counting logic (error path / regression for the bug where the catch block never advanced retryCount, causing an infinite generate_code<->inspect_result loop)", async () => {
    mockGenerateJSON.mockRejectedValue(new Error("429 quota exhausted"));

    // First call: no prior attempts yet -> retryCount stays 0 (first attempt, not a retry).
    const first = await generateCode(baseState());
    expect(first.error).toMatch(/llm_unavailable/);
    expect(first.retryCount).toBe(0);

    // Simulate the graph's retry loop: inspect_result routed back to
    // generate_code with an appended failed attempt and the retryCount
    // carried forward from the first call.
    const secondState = {
      ...baseState(),
      attempts: [{ code: "", executionResult: { error: "no code produced" } }],
      retryCount: first.retryCount,
    };
    const second = await generateCode(secondState);
    expect(second.error).toMatch(/llm_unavailable/);
    expect(second.retryCount).toBe(1);

    // Third call: another failed attempt appended, retryCount carried forward again.
    const thirdState = {
      ...baseState(),
      attempts: [
        { code: "", executionResult: { error: "no code produced" } },
        { code: "", executionResult: { error: "no code produced" } },
      ],
      retryCount: second.retryCount,
    };
    const third = await generateCode(thirdState);
    expect(third.error).toMatch(/llm_unavailable/);
    expect(third.retryCount).toBe(2);

    // retryCount has now reached MAX_CODE_RETRIES, so the graph's
    // conditional edge on inspect_result (`(s.retryCount || 0) <
    // MAX_CODE_RETRIES`) would stop routing back to generate_code and fall
    // through instead — proving the bounded retry loop terminates.
    expect(third.retryCount).toBe(MAX_CODE_RETRIES);
  });
});
