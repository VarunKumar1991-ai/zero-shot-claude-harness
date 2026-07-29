"use strict";

const { SchemaType } = require("@google/generative-ai");
const geminiClient = require("../../llm/geminiClient");
const { loadPrompt } = require("../promptLoader");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    code: { type: SchemaType.STRING },
    explanation: { type: SchemaType.STRING },
  },
  required: ["code", "explanation"],
};

function buildUserPrompt(state) {
  const profile = state.datasetProfile || {};
  const sampleRows = Array.isArray(state.sampleRows) ? state.sampleRows.slice(0, 20) : [];
  const plan = Array.isArray(state.planSteps) ? state.planSteps : [];
  const attempts = Array.isArray(state.attempts) ? state.attempts : [];

  const parts = [
    `Dataset columns: ${JSON.stringify(profile.columns || [])}`,
    `Row count: ${profile.rowCount ?? "unknown"}`,
    `Sample rows (<=20, for shape/format reference ONLY — the real \`rows\` variable at execution time holds the FULL dataset, not this sample): ${JSON.stringify(sampleRows)}`,
  ];

  if (plan.length) {
    parts.push(`Plan to implement:\n${plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }

  parts.push(`Officer's question: ${state.question}`);

  if (attempts.length) {
    const last = attempts[attempts.length - 1];
    parts.push(
      [
        `This is a RETRY. The previous attempt failed or was judged insufficient:`,
        `Previous code:\n${last.code}`,
        `Previous execution error: ${last.executionResult && last.executionResult.error ? last.executionResult.error : "(none)"}`,
        `Previous execution result: ${JSON.stringify(last.executionResult && last.executionResult.result)}`,
        `Inspection note: ${last.inspection && last.inspection.note ? last.inspection.note : "(none)"}`,
        `Try a genuinely different approach, or fix the specific bug — do not repeat the same code.`,
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}

async function generateCode(state) {
  try {
    const system = loadPrompt("generate_code");
    const model = process.env.AGENT_LLM_MODEL_PRIMARY || "gemini-3.1-pro";
    const { data, tokenUsage } = await geminiClient.generateJSON(buildUserPrompt(state), {
      model,
      systemInstruction: system,
      responseSchema: RESPONSE_SCHEMA,
    });

    const prevUsage = state.tokenUsage || { promptTokens: 0, completionTokens: 0 };
    const attempts = Array.isArray(state.attempts) ? state.attempts : [];
    // Each subsequent pass through generate_code (i.e. this is a retry off
    // inspect_result's "retry" verdict) advances the bounded retry counter;
    // the routing check itself lives in the graph's conditional edge.
    const retryCount = attempts.length > 0 ? (state.retryCount || 0) + 1 : state.retryCount || 0;

    return {
      generatedCode: data.code,
      codeExplanation: data.explanation,
      retryCount,
      tokenUsage: {
        promptTokens: prevUsage.promptTokens + tokenUsage.promptTokens,
        completionTokens: prevUsage.completionTokens + tokenUsage.completionTokens,
      },
    };
  } catch (err) {
    // A code-generation LLM failure is still an llm_unavailable condition, but
    // execute_code/inspect_result need SOME code string to run against; we
    // surface it as an execution-less failed attempt so the retry loop or
    // handle_error can react rather than crashing the graph.
    // A failed LLM call is just as much a "used attempt" as a bad-code
    // attempt, so it must advance the same bounded retry counter as the
    // success path — otherwise repeated LLM failures (e.g. quota exhaustion)
    // route back to generate_code forever instead of degrading gracefully.
    const attempts = Array.isArray(state.attempts) ? state.attempts : [];
    const retryCount = attempts.length > 0 ? (state.retryCount || 0) + 1 : state.retryCount || 0;
    return {
      generatedCode: "",
      codeExplanation: "",
      retryCount,
      error: `llm_unavailable: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { generateCode, RESPONSE_SCHEMA };
