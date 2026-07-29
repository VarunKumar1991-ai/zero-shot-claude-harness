"use strict";

/**
 * Loads a persisted dataset's full parsed rows back into memory by id, for
 * the `qa-api` slice's `POST /api/datasets/:id/queries` route.
 *
 * Phase 1 always has exactly one `DatasetFile` per `Dataset` (per
 * spec/data.md), so this re-parses that single file from disk on every
 * query (never sampled — the profiler's full-file scan is the same code
 * path used at upload time, see src/services/csvParser.js). This is a small
 * addition needed to close the loop between `upload-profile-api`'s
 * persistence and `agent-graph`'s `runAgentGraph({ rows, ... })` contract —
 * neither of those slices owns "re-read a dataset's rows by id".
 */

const path = require("path");

const { parseCsvFile } = require("./csvParser");
const db = require("../db/models");

/**
 * @param {string} datasetId
 * @returns {Promise<{ dataset: object, rows: object[], columns: string[] } | null>}
 *   null if the dataset does not exist.
 */
async function loadDatasetRows(datasetId) {
  const dataset = await db.Dataset.findByPk(datasetId);
  if (!dataset) return null;

  const datasetFile = await db.DatasetFile.findOne({
    where: { datasetId },
    order: [["uploadedAt", "ASC"]],
  });
  if (!datasetFile) return null;

  const absolutePath = path.isAbsolute(datasetFile.filePath)
    ? datasetFile.filePath
    : path.resolve(process.cwd(), datasetFile.filePath);

  const parsed = await parseCsvFile(absolutePath);

  // Strip parser-internal bookkeeping fields (__rowIndex/__issues) before
  // handing rows to the agent graph — those are upload-time quality-flag
  // metadata, not part of the officer's actual data shape.
  const rows = parsed.rows.map(({ __rowIndex, __issues, ...rest }) => rest);
  const columns = parsed.columns.map((c) => c.name);

  return { dataset, rows, columns };
}

module.exports = { loadDatasetRows };
