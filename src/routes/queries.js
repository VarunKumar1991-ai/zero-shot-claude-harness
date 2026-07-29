"use strict";

/**
 * Query (Q&A) routes — POST /:id/queries, GET /:id/queries.
 * Mounted at /api/datasets in src/index.js, alongside src/routes/datasets.js
 * (which owns `/`, `/:id/profile`) — this router only owns the `/:id/queries`
 * sub-path, so the two mount cleanly at the same base without shadowing each
 * other. Contract: spec/api.md. Expects to run behind session middleware
 * upstream (req.user set by src/middleware/session.js).
 */

const express = require("express");
const { randomUUID } = require("crypto");

const { runAgentGraph } = require("../agent/graph");
const { loadDatasetRows } = require("../services/datasetLoader");
const { recordQuery, listQueries } = require("../services/auditService");

const router = express.Router();

function unauthorized(res) {
  return res.status(401).json({ data: null, error: { code: "unauthorized", message: "Not logged in." } });
}

function badRequest(res, message) {
  return res.status(400).json({ data: null, error: { code: "bad_request", message } });
}

function notFound(res) {
  return res.status(404).json({ data: null, error: { code: "not_found", message: "Dataset not found." } });
}

function toDatasetProfile(dataset) {
  return {
    columns: (dataset.columns || []).map((c) => c.name),
    rowCount: dataset.rowCount,
    dateRange: [dataset.dateRangeMin || null, dataset.dateRangeMax || null],
    qualityFlags: dataset.qualityFlags || [],
  };
}

function serializeQueryResponse(id, graphResult, createdAt, completedAt) {
  return {
    id,
    status: graphResult.status,
    answer: graphResult.answer,
    keyNumbers: graphResult.keyNumbers,
    assumptions: graphResult.assumptions,
    clarifyingQuestion: graphResult.clarifyingQuestion,
    generatedCode: graphResult.code,
    attempts: graphResult.steps,
    chartSpec: null,
    followups: graphResult.followups,
    tokenUsage: graphResult.tokenUsage,
    createdAt: createdAt.toISOString(),
    completedAt: completedAt.toISOString(),
  };
}

/**
 * POST /api/datasets/:id/queries — run the agent graph against a question,
 * persist the audit row, and return the full answer.
 */
router.post("/:id/queries", async (req, res) => {
  if (!req.user || !req.user.id) return unauthorized(res);

  const datasetId = req.params.id;
  const question = req.body && typeof req.body.question === "string" ? req.body.question.trim() : "";
  const sessionId = (req.body && req.body.sessionId) || randomUUID();

  if (!question) {
    return badRequest(res, "A non-empty `question` is required.");
  }

  let loaded;
  try {
    loaded = await loadDatasetRows(datasetId);
  } catch (err) {
    req.log?.error?.({ err: err.message, datasetId }, "failed to load dataset rows for query");
    console.error("[queries] failed to load dataset rows:", err.message);
    return res.status(500).json({
      data: null,
      error: { code: "internal_error", message: "Failed to load the dataset for analysis." },
    });
  }

  if (!loaded) return notFound(res);

  const { dataset, rows, columns } = loaded;
  const runId = randomUUID();
  const createdAt = new Date();

  let graphResult;
  try {
    graphResult = await runAgentGraph({
      rows,
      columns,
      question,
      datasetProfile: toDatasetProfile(dataset),
      runId,
      userId: req.user.id,
      datasetId,
    });
  } catch (err) {
    // Programmer/caller-contract errors only (see agent/graph.js's JSDoc) —
    // ordinary LLM/sandbox failures are represented in graphResult.status.
    req.log?.error?.({ err: err.message, datasetId }, "agent graph invocation failed");
    console.error("[queries] agent graph invocation failed:", err.message);
    const completedAt = new Date();
    const failedResult = {
      status: "failed",
      answer: null,
      keyNumbers: [],
      assumptions: [],
      clarifyingQuestion: null,
      code: null,
      steps: [],
      followups: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0 },
      error: err.message,
    };
    try {
      await recordQuery({
        id: runId,
        datasetId,
        userId: req.user.id,
        sessionId,
        question,
        graphResult: failedResult,
        createdAt,
        completedAt,
      });
    } catch (persistErr) {
      console.error("[queries] failed to persist failed-run audit row:", persistErr.message);
    }
    return res.status(502).json({
      data: serializeQueryResponse(runId, failedResult, createdAt, completedAt),
      error: { code: "llm_unavailable", message: "Couldn't complete that analysis — the AI service didn't respond." },
    });
  }

  const completedAt = new Date();

  try {
    await recordQuery({
      id: runId,
      datasetId,
      userId: req.user.id,
      sessionId,
      question,
      graphResult,
      createdAt,
      completedAt,
    });
  } catch (err) {
    req.log?.error?.({ err: err.message, datasetId, runId }, "failed to persist query audit row");
    console.error("[queries] failed to persist audit row:", err.message);
    return res.status(500).json({
      data: null,
      error: { code: "internal_error", message: "Analysis completed but the audit log could not be saved." },
    });
  }

  req.log?.info?.(
    { datasetId, runId, status: graphResult.status, retryCount: graphResult.retryCount },
    "query answered"
  );

  if (graphResult.status === "failed") {
    return res.status(502).json({
      data: serializeQueryResponse(runId, graphResult, createdAt, completedAt),
      error: { code: "llm_unavailable", message: "Couldn't complete that analysis — the AI service didn't respond." },
    });
  }

  return res.status(200).json({ data: serializeQueryResponse(runId, graphResult, createdAt, completedAt), error: null });
});

/**
 * GET /api/datasets/:id/queries — the query/audit history for a dataset,
 * most recent first.
 */
router.get("/:id/queries", async (req, res) => {
  if (!req.user || !req.user.id) return unauthorized(res);

  const datasetId = req.params.id;

  try {
    const db = require("../db/models");
    const dataset = await db.Dataset.findByPk(datasetId);
    if (!dataset) return notFound(res);

    const queries = await listQueries(datasetId);
    return res.status(200).json({
      data: queries.map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        status: q.status,
        createdAt: q.createdAt,
      })),
      error: null,
    });
  } catch (err) {
    req.log?.error?.({ err: err.message, datasetId }, "failed to list query history");
    console.error("[queries] failed to list query history:", err.message);
    return res.status(500).json({
      data: null,
      error: { code: "internal_error", message: "Failed to fetch query history." },
    });
  }
});

module.exports = router;
