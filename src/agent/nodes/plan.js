"use strict";

const { SchemaType } = require("@google/generative-ai");
const geminiClient = require("../../llm/geminiClient");
const { loadPrompt } = require("../promptLoader");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    steps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ["steps"],
};

function buildUserPrompt(state) {
  const profile = state.datasetProfile || {};
  return [
    `Dataset columns: ${JSON.stringify(profile.columns || [])}`,
    `Row count: ${profile.rowCount ?? "unknown"}`,
    `Officer's question: ${state.question}`,
  ].join("\n");
}

async function plan(state) {
  // Only runs when complexity === "complex" (enforced by the graph's routing);
  // defensively no-op otherwise so this node is safe to call directly in tests.
  if (state.complexity !== "complex") {
    return { planSteps: [] };
  }

  try {
    const system = loadPrompt("plan");
    const model = process.env.AGENT_LLM_MODEL_PRIMARY || "gemini-3.1-pro";
    const { data, tokenUsage } = await geminiClient.generateJSON(buildUserPrompt(state), {
      model,
      systemInstruction: system,
      responseSchema: RESPONSE_SCHEMA,
    });

    const prevUsage = state.tokenUsage || { promptTokens: 0, completionTokens: 0 };

    return {
      planSteps: Array.isArray(data.steps) ? data.steps : [],
      tokenUsage: {
        promptTokens: prevUsage.promptTokens + tokenUsage.promptTokens,
        completionTokens: prevUsage.completionTokens + tokenUsage.completionTokens,
      },
    };
  } catch (err) {
    if (err && err.code === "llm_unavailable") {
      return { error: "llm_unavailable" };
    }
    return { error: `llm_unavailable: ${err && err.message ? err.message : String(err)}` };
  }
}

module.exports = { plan, RESPONSE_SCHEMA };
