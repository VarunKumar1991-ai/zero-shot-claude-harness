"use strict";

const { SchemaType } = require("@google/generative-ai");
const geminiClient = require("../../llm/geminiClient");
const { loadPrompt } = require("../promptLoader");
const { MAX_CODE_RETRIES } = require("../constants");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    verdict: { type: SchemaType.STRING, format: "enum", enum: ["ok", "retry", "give_up"] },
    note: { type: SchemaType.STRING },
  },
  required: ["verdict", "note"],
};

/**
 * Fast deterministic path: no execution error AND the result is a plain
 * number or a small array/object — skip the LLM round-trip entirely for the
 * common simple-count case (per spec/agent.md's inspect_result behaviour).
 */
function fastPathVerdict(executionResult) {
  if (!executionResult || executionResult.error) return null;
  const { result } = executionResult;
  if (typeof result === "number" && Number.isFinite(result)) {
    return { verdict: "ok", note: "deterministic check: numeric result, no execution error" };
  }
  if (Array.isArray(result) && result.length <= 50) {
    return { verdict: "ok", note: "deterministic check: small array result, no execution error" };
  }
  return null;
}

function buildUserPrompt(state) {
  const { executionResult } = state;
  return [
    `Officer's question: ${state.question}`,
    `Execution error: ${executionResult && executionResult.error ? executionResult.error : "(none)"}`,
    `Computed result: ${JSON.stringify(executionResult && executionResult.result)}`,
    `Retry budget remaining: ${MAX_CODE_RETRIES - (state.retryCount || 0)}`,
  ].join("\n");
}

async function inspectResult(state) {
  const executionResult = state.executionResult || { result: undefined, error: "no execution result" };

  const fastPath = fastPathVerdict(executionResult);
  if (fastPath) {
    return { inspectionVerdict: fastPath.verdict, inspectionNote: fastPath.note };
  }

  try {
    const system = loadPrompt("inspect_result");
    const model = process.env.AGENT_LLM_MODEL_FAST || "gemini-2.5-flash";
    const { data, tokenUsage } = await geminiClient.generateJSON(buildUserPrompt(state), {
      model,
      systemInstruction: system,
      responseSchema: RESPONSE_SCHEMA,
    });

    const verdict = ["ok", "retry", "give_up"].includes(data.verdict) ? data.verdict : "give_up";
    const prevUsage = state.tokenUsage || { promptTokens: 0, completionTokens: 0 };

    return {
      inspectionVerdict: verdict,
      inspectionNote: data.note || "",
      tokenUsage: {
        promptTokens: prevUsage.promptTokens + tokenUsage.promptTokens,
        completionTokens: prevUsage.completionTokens + tokenUsage.completionTokens,
      },
    };
  } catch (err) {
    // If the sanity-check LLM call itself fails, don't fail the whole run —
    // degrade to "give_up" so synthesize_answer still runs and flags the
    // uncertainty as an assumption, per the "never a fabricated answer, but
    // also never crash on a non-critical check" principle.
    return {
      inspectionVerdict: "give_up",
      inspectionNote: `inspection unavailable: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { inspectResult, RESPONSE_SCHEMA, fastPathVerdict };
