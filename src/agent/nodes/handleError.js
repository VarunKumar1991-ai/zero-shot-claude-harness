"use strict";

/**
 * handle_error — terminal failure handler.
 *
 * Slice-boundary note: this agent-graph slice does not persist to SQLite
 * (see graph.js's top-of-file JSDoc) — the `qa-api` slice persists the
 * failed-query audit row using the fields returned by `runAgentGraph`
 * (status="failed", error, attempts made so far). This node's job is
 * limited to producing the clear, human-facing error message and marking
 * status — never a raw stack trace to the officer.
 */
async function handleError(state) {
  const cause = state.error || "unknown_error";
  return {
    status: "failed",
    answer:
      cause.startsWith("llm_unavailable")
        ? "The analysis service is temporarily unavailable, please try again."
        : "Something went wrong while analyzing your question. Please try again or contact support if it persists.",
  };
}

module.exports = { handleError };
