"use strict";

/**
 * finalize — assembles the final state; status becomes "completed" (or stays
 * "needs_clarification" when classify routed straight here).
 *
 * Slice-boundary note: this node does NOT write to SQLite (see graph.js's
 * top-of-file JSDoc) — the `qa-api` slice persists the full audit row
 * (question, generated code + all attempts, result, answer, timestamps,
 * token usage) using the object `runAgentGraph` returns.
 */
async function finalize(state) {
  const status = state.complexity === "needs_clarification" ? "needs_clarification" : "completed";
  return { status };
}

module.exports = { finalize };
