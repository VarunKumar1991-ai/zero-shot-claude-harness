"use strict";

/**
 * load_context
 *
 * Design note (slice boundary): this agent-graph slice does not touch the DB
 * or file storage (see spec/roadmap.md's Phase-1 slice split — `qa-api` owns
 * that). The caller of `runAgentGraph` (the `qa-api` slice) is responsible
 * for loading the dataset profile from SQLite and re-parsing/streaming the
 * CSV from disk into `rows` BEFORE invoking the graph, and passes
 * `{ rows, columns, datasetProfile }` in as the initial graph state. This
 * node's job is therefore narrower than spec/agent.md's literal "reads
 * SQLite + disk" description: it validates that context arrived intact and
 * derives the <=20-row `sampleRows` slice used for LLM prompt context —
 * `rows` (the full dataset) is never placed in a prompt.
 */

const MAX_SAMPLE_ROWS = 20;

async function loadContext(state) {
  try {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const columns = Array.isArray(state.columns) ? state.columns : [];
    const datasetProfile = state.datasetProfile || null;

    if (!datasetProfile) {
      return { error: "parse_error: datasetProfile is required but was not provided" };
    }
    if (!Array.isArray(state.rows)) {
      return { error: "parse_error: rows must be an array (loaded by the caller before invoking the graph)" };
    }

    const sampleRows = rows.slice(0, MAX_SAMPLE_ROWS);

    return {
      rows,
      columns,
      datasetProfile,
      sampleRows,
      annotations: Array.isArray(state.annotations) ? state.annotations : [],
    };
  } catch (err) {
    return { error: `parse_error: ${err && err.message ? err.message : String(err)}` };
  }
}

module.exports = { loadContext, MAX_SAMPLE_ROWS };
