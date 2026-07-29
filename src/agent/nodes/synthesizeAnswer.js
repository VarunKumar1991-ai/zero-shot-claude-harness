"use strict";

const { SchemaType } = require("@google/generative-ai");
const geminiClient = require("../../llm/geminiClient");
const { loadPrompt } = require("../promptLoader");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    answer: { type: SchemaType.STRING },
    keyNumbers: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          label: { type: SchemaType.STRING },
          value: { type: SchemaType.STRING },
        },
        required: ["label", "value"],
      },
    },
    assumptions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ["answer", "keyNumbers", "assumptions"],
};

function buildUserPrompt(state) {
  const executionResult = state.executionResult || {};
  return [
    `Officer's question: ${state.question}`,
    `Computed result (already run against the FULL dataset via real code execution): ${JSON.stringify(executionResult.result)}`,
    `Execution error (if any): ${executionResult.error || "(none)"}`,
    `Inspection verdict: ${state.inspectionVerdict || "(none)"}`,
    `Inspection note: ${state.inspectionNote || "(none)"}`,
    `Number of code-generation attempts made: ${(state.attempts || []).length}`,
  ].join("\n");
}

async function synthesizeAnswer(state) {
  try {
    const system = loadPrompt("synthesize_answer");
    const model = process.env.AGENT_LLM_MODEL_PRIMARY || "gemini-3.1-pro";
    const { data, tokenUsage } = await geminiClient.generateJSON(buildUserPrompt(state), {
      model,
      systemInstruction: system,
      responseSchema: RESPONSE_SCHEMA,
    });

    const prevUsage = state.tokenUsage || { promptTokens: 0, completionTokens: 0 };
    const inspectionFlagged = state.inspectionVerdict && state.inspectionVerdict !== "ok";
    let assumptions = Array.isArray(data.assumptions) ? data.assumptions : [];
    if (inspectionFlagged && assumptions.length === 0) {
      assumptions = [
        `The agent could not fully confirm this result (${state.inspectionNote || "inspection flagged uncertainty"}) — treat as a best-guess answer.`,
      ];
    }

    return {
      answer: data.answer,
      keyNumbers: Array.isArray(data.keyNumbers) ? data.keyNumbers : [],
      assumptions,
      tokenUsage: {
        promptTokens: prevUsage.promptTokens + tokenUsage.promptTokens,
        completionTokens: prevUsage.completionTokens + tokenUsage.completionTokens,
      },
    };
  } catch (err) {
    const executionResult = state.executionResult || {};
    return {
      answer:
        "The analysis service is temporarily unavailable, so I couldn't finish writing a plain-language answer. " +
        (executionResult.result !== undefined
          ? `The last computed result was: ${JSON.stringify(executionResult.result)}.`
          : "No result was computed."),
      keyNumbers: [],
      assumptions: ["Answer synthesis failed — this is a raw fallback, not a verified answer."],
      error: `llm_unavailable: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = { synthesizeAnswer, RESPONSE_SCHEMA };
