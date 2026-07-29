"use strict";

const { SchemaType } = require("@google/generative-ai");
const geminiClient = require("../../llm/geminiClient");
const { loadPrompt } = require("../promptLoader");

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    complexity: { type: SchemaType.STRING, format: "enum", enum: ["simple", "complex", "needs_clarification"] },
    clarifyingQuestion: { type: SchemaType.STRING },
  },
  required: ["complexity"],
};

function buildUserPrompt(state) {
  const profile = state.datasetProfile || {};
  const history = Array.isArray(state.conversationHistory) ? state.conversationHistory : [];
  const historyText = history.length
    ? history.map((h, i) => `${i + 1}. Q: ${h.question}\n   A: ${h.answer}`).join("\n")
    : "(none — this is the first question in this session)";

  return [
    `Dataset columns: ${JSON.stringify(profile.columns || [])}`,
    `Row count: ${profile.rowCount ?? "unknown"}`,
    `Date range: ${JSON.stringify(profile.dateRange || null)}`,
    `Prior conversation turns:\n${historyText}`,
    ``,
    `Officer's question: ${state.question}`,
  ].join("\n");
}

async function classify(state) {
  try {
    const system = loadPrompt("classify");
    const model = process.env.AGENT_LLM_MODEL_FAST || "gemini-2.5-flash";
    const { data, tokenUsage } = await geminiClient.generateJSON(buildUserPrompt(state), {
      model,
      systemInstruction: system,
      responseSchema: RESPONSE_SCHEMA,
    });

    const complexity = ["simple", "complex", "needs_clarification"].includes(data.complexity)
      ? data.complexity
      : "simple";

    const prevUsage = state.tokenUsage || { promptTokens: 0, completionTokens: 0 };

    return {
      complexity,
      clarifyingQuestion: complexity === "needs_clarification" ? data.clarifyingQuestion || null : null,
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

module.exports = { classify, RESPONSE_SCHEMA };
