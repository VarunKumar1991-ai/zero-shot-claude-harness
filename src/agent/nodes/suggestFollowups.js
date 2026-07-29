"use strict";

/**
 * suggest_followups — Phase 1 STRUCTURAL STUB.
 *
 * Wired into the graph as a real node (not skipped) so the graph shape and
 * `finalize` contract are stable from day one, per spec/agent.md. It always
 * returns an empty list in Phase 1.
 *
 * Phase 2: real follow-up suggestion logic (Gemini Flash call generating
 * 2-3 relevant next questions from `question`, `answer`, `datasetProfile`).
 */
async function suggestFollowups(_state) {
  return { followups: [] };
}

module.exports = { suggestFollowups };
