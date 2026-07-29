"use strict";

/**
 * Audit-log persistence for `qa-api` — creates/lists `queries` rows via the
 * Sequelize `Query` model (see spec/data.md's "Query (Audit Log)" entity).
 * Pure DB-access helper, no HTTP concerns; used by src/routes/queries.js.
 */

const db = require("../db/models");

/**
 * Persist one full audit-log entry for a completed (or failed / needing
 * clarification) agent run.
 *
 * @param {object} params
 * @param {string} params.id - runId, shared with the agent graph's own id.
 * @param {string} params.datasetId
 * @param {string} params.userId
 * @param {string} params.sessionId
 * @param {string} params.question
 * @param {object} params.graphResult - the object returned by runAgentGraph.
 * @param {Date} params.createdAt - run start time.
 * @param {Date} params.completedAt - run end time.
 */
async function recordQuery({ id, datasetId, userId, sessionId, question, graphResult, createdAt, completedAt }) {
  return db.Query.create({
    id,
    datasetId,
    userId,
    sessionId,
    question,
    complexity: graphResult.complexity || null,
    plan: null,
    generatedCode: graphResult.code || null,
    attempts: graphResult.steps || [],
    result: graphResult.keyNumbers && graphResult.keyNumbers.length ? graphResult.keyNumbers : null,
    answer: graphResult.answer || null,
    keyNumbers: graphResult.keyNumbers || [],
    assumptions: graphResult.assumptions || [],
    chartSpec: null,
    followups: graphResult.followups || [],
    tokenUsage: graphResult.tokenUsage || { promptTokens: 0, completionTokens: 0 },
    status: graphResult.status || "failed",
    error: graphResult.error || null,
    createdAt,
    completedAt,
  });
}

/**
 * Return the query/audit history for a dataset, most recent first.
 */
async function listQueries(datasetId) {
  return db.Query.findAll({
    where: { datasetId },
    order: [["createdAt", "DESC"]],
  });
}

module.exports = { recordQuery, listQueries };
