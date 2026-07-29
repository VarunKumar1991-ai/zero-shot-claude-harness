"use strict";

/**
 * ============================================================================
 * runAgentGraph — the public entry point for this slice.
 * ============================================================================
 *
 * Consumed by the `qa-api` slice (a separate generator, built after this
 * one) from its HTTP route handler. This slice does NOT touch Express
 * routes, the DB, or file upload/parsing — the caller is responsible for:
 *   - loading the dataset's persisted profile from SQLite
 *   - re-parsing/streaming the CSV from disk into `rows` (typed row objects)
 *   - generating/propagating `runId`, `userId`, `datasetId` for its own
 *     audit-log write (this slice does not write to SQLite either — see
 *     nodes/handleError.js and nodes/finalize.js for the boundary note)
 *
 * ----------------------------------------------------------------------------
 * Signature
 * ----------------------------------------------------------------------------
 *
 * runAgentGraph({ rows, columns, question, datasetProfile, conversationHistory?,
 *                  annotations?, runId?, userId?, datasetId? })
 *   -> Promise<{
 *        status: "completed" | "needs_clarification" | "failed",
 *        answer: string | null,
 *        keyNumbers: Array<{ label: string, value: any }>,
 *        assumptions: string[],
 *        clarifyingQuestion: string | null,
 *        code: string | null,              // final generatedCode (the code that
 *                                           // actually produced the answer, i.e.
 *                                           // the last attempt's code)
 *        steps: Array<{ code, explanation, executionResult, inspection? }>,
 *                                           // == state.attempts, full retry trace,
 *                                           // for the "Show code"/audit disclosure
 *        followups: string[],              // Phase 1: always []
 *        complexity: "simple" | "complex" | "needs_clarification" | undefined,
 *        retryCount: number,
 *        tokenUsage: { promptTokens: number, completionTokens: number },
 *        error: string | null,             // machine-readable cause code, if any
 *      }>
 *
 * Inputs:
 *   - rows            REQUIRED. Array<Record<string, any>> — the full parsed
 *                      dataset. Stays in this process for the duration of the
 *                      call; NEVER placed in an LLM prompt (only a <=20-row
 *                      sample derived from it is).
 *   - columns         Array<string> — column names (informational; also
 *                      derivable from datasetProfile.columns).
 *   - question        REQUIRED. string — the officer's natural-language question.
 *   - datasetProfile  REQUIRED. { columns, rowCount, dateRange, qualityFlags }
 *                      as produced by the `upload-profile-api` slice's profiler.
 *   - conversationHistory  Phase 2. Array<{question, answer}> — defaults to [].
 *   - annotations          Phase 2. Array<...> — defaults to [].
 *   - runId/userId/datasetId  Optional identity passthrough, useful for the
 *      caller's own audit-log correlation and for pino/LangSmith tracing;
 *      this slice does not require them to function.
 *
 * Never throws for ordinary failure modes (LLM outage, sandbox crash, bad
 * question) — those are represented in the returned `status`/`error`/`answer`
 * fields, per spec/agent.md's "never a fabricated answer, never a raw
 * stack trace" rule. It CAN throw for genuine programmer errors (e.g.
 * `rows` or `question` missing) since those indicate a caller bug, not a
 * runtime condition the graph is designed to recover from.
 * ============================================================================
 */

const { StateGraph, END } = require("@langchain/langgraph");
const { randomUUID } = require("crypto");
const { AgentState } = require("./state");
const { MAX_CODE_RETRIES } = require("./constants");
const {
  loadContext,
  classify,
  plan,
  generateCode,
  executeCode,
  inspectResult,
  synthesizeAnswer,
  suggestFollowups,
  handleError,
  finalize,
} = require("./nodes/index");

function buildGraph() {
  const g = new StateGraph(AgentState);

  g.addNode("load_context", loadContext);
  g.addNode("classify", classify);
  g.addNode("plan", plan);
  g.addNode("generate_code", generateCode);
  g.addNode("execute_code", executeCode);
  g.addNode("inspect_result", inspectResult);
  g.addNode("synthesize_answer", synthesizeAnswer);
  g.addNode("suggest_followups", suggestFollowups);
  g.addNode("handle_error", handleError);
  g.addNode("finalize", finalize);

  g.setEntryPoint("load_context");

  g.addConditionalEdges("load_context", (s) => (s.error ? "handle_error" : "classify"));

  g.addConditionalEdges("classify", (s) => {
    if (s.error) return "handle_error";
    if (s.complexity === "needs_clarification") return "finalize";
    if (s.complexity === "complex") return "plan";
    return "generate_code";
  });

  g.addEdge("plan", "generate_code");
  g.addEdge("generate_code", "execute_code");
  g.addEdge("execute_code", "inspect_result");

  g.addConditionalEdges("inspect_result", (s) => {
    if (s.inspectionVerdict === "retry" && (s.retryCount || 0) < MAX_CODE_RETRIES) {
      return "generate_code";
    }
    return "synthesize_answer";
  });

  g.addEdge("synthesize_answer", "suggest_followups");
  g.addEdge("suggest_followups", "finalize");
  g.addEdge("finalize", END);
  g.addEdge("handle_error", END);

  return g.compile();
}

const agentGraph = buildGraph();

/** @see the module-level JSDoc above for the full contract. */
async function runAgentGraph(input) {
  if (!input || typeof input !== "object") {
    throw new Error("runAgentGraph requires an input object");
  }
  const { rows, columns, question, datasetProfile } = input;
  if (!Array.isArray(rows)) {
    throw new Error("runAgentGraph requires `rows` to be an array (the full parsed dataset)");
  }
  if (typeof question !== "string" || !question.trim()) {
    throw new Error("runAgentGraph requires a non-empty `question` string");
  }
  if (!datasetProfile || typeof datasetProfile !== "object") {
    throw new Error("runAgentGraph requires `datasetProfile` (the profiler output)");
  }

  const initialState = {
    runId: input.runId || randomUUID(),
    userId: input.userId || null,
    datasetId: input.datasetId || null,
    question,
    conversationHistory: Array.isArray(input.conversationHistory) ? input.conversationHistory : [],
    datasetProfile,
    annotations: Array.isArray(input.annotations) ? input.annotations : [],
    sampleRows: [],
    rows,
    columns: Array.isArray(columns) ? columns : datasetProfile.columns || [],
    complexity: undefined,
    clarifyingQuestion: null,
    planSteps: [],
    generatedCode: undefined,
    codeExplanation: undefined,
    executionResult: null,
    attempts: [],
    retryCount: 0,
    inspectionVerdict: undefined,
    inspectionNote: undefined,
    answer: null,
    keyNumbers: [],
    assumptions: [],
    chartSpec: null,
    followups: [],
    tokenUsage: { promptTokens: 0, completionTokens: 0 },
    error: null,
    status: "running",
  };

  const finalState = await agentGraph.invoke(initialState, {
    configurable: { runId: initialState.runId },
    runName: "up-police-analyst-agent-graph",
  });

  return {
    status: finalState.status || "completed",
    answer: finalState.answer ?? null,
    keyNumbers: finalState.keyNumbers || [],
    assumptions: finalState.assumptions || [],
    clarifyingQuestion: finalState.clarifyingQuestion || null,
    code: finalState.generatedCode || null,
    steps: finalState.attempts || [],
    followups: finalState.followups || [],
    complexity: finalState.complexity,
    retryCount: finalState.retryCount || 0,
    tokenUsage: finalState.tokenUsage || { promptTokens: 0, completionTokens: 0 },
    error: finalState.error || null,
    runId: initialState.runId,
  };
}

module.exports = { runAgentGraph, agentGraph, buildGraph };
