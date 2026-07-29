"use strict";

/**
 * Thin wrapper around @google/generative-ai.
 *
 * generate(prompt, { model, systemInstruction, responseSchema, temperature })
 *   -> Promise<{ text, model, tokenUsage: { promptTokens, completionTokens } }>
 *
 * generateJSON(prompt, options) -- same options, additionally requires
 * options.responseSchema (Gemini JSON-mode response schema) and returns
 * { data: <parsed JSON>, model, tokenUsage } with the raw text already
 * JSON.parse()'d for the caller.
 *
 * - API key read from AGENT_GEMINI_API_KEY (.env) — never hardcoded, never logged.
 * - Retried with exponential backoff (500ms / 1500ms / 4000ms) on transient
 *   429/503 errors, per spec/agent.md's fallback behaviour. On exhausted
 *   retries throws an Error with `.code === "llm_unavailable"` so callers can
 *   route to handle_error without inspecting error prose.
 * - Captures `usageMetadata` from every response so token/cost usage can be
 *   surfaced per-query (audit-log relevant even though the UI for it may be
 *   a Phase 2 concern).
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

const RETRY_DELAYS_MS = [500, 1500, 4000];

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.AGENT_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AGENT_GEMINI_API_KEY is not set — required for real Gemini calls (see .env)");
  }
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

/** Test-only hook so unit tests can reset the memoized client between runs. */
function _resetClientForTests() {
  _client = null;
}

function isRetriable(err) {
  const status = err && (err.status || err.code || (err.response && err.response.status));
  if (status === 429 || status === 503) return true;
  const message = (err && err.message) || "";
  return /429|503|rate.?limit|unavailable|overloaded/i.test(message);
}

async function generate(prompt, options = {}) {
  const {
    model = process.env.AGENT_LLM_MODEL_FAST || "gemini-2.5-flash",
    systemInstruction,
    responseSchema,
    temperature,
  } = options;

  const generationConfig = {};
  if (responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = responseSchema;
  }
  if (typeof temperature === "number") generationConfig.temperature = temperature;

  const genModel = getClient().getGenerativeModel({
    model,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  });

  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await genModel.generateContent(prompt);
      const text = res.response.text();
      const usage = res.response.usageMetadata || {};
      return {
        text,
        model,
        tokenUsage: {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
        },
      };
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS_MS.length && isRetriable(err)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      break;
    }
  }

  const wrapped = new Error(
    `llm_unavailable: Gemini call failed after retries — ${lastError && lastError.message ? lastError.message : String(lastError)}`
  );
  wrapped.code = "llm_unavailable";
  wrapped.cause = lastError;
  throw wrapped;
}

async function generateJSON(prompt, options = {}) {
  if (!options.responseSchema) {
    throw new Error("generateJSON requires options.responseSchema");
  }
  const { text, model, tokenUsage } = await generate(prompt, options);
  try {
    return { data: JSON.parse(text), model, tokenUsage };
  } catch (err) {
    const wrapped = new Error(`llm_unavailable: failed to parse structured JSON response — ${err.message}`);
    wrapped.code = "llm_unavailable";
    wrapped.rawText = text;
    throw wrapped;
  }
}

module.exports = { generate, generateJSON, getClient, _resetClientForTests };
