"use strict";

/**
 * Dataset routes — POST /, GET /, GET /:id/profile.
 * Mounted at /api/datasets in src/index.js. Contract: spec/api.md.
 *
 * Expects to run behind session middleware upstream (req.user set by
 * src/middleware/session.js) — this router never implements its own auth,
 * it only checks that req.user is present.
 */

const express = require("express");
const multer = require("multer");
const { randomUUID } = require("crypto");

const { parseCsvBuffer } = require("../services/csvParser");
const { computeProfile } = require("../services/profiler");
const { saveDatasetFile, removeDatasetDirectory } = require("../storage");
const db = require("../db/models");

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

const router = express.Router();

function unauthorized(res) {
  return res.status(401).json({ data: null, error: { code: "unauthorized", message: "Not logged in." } });
}

function badRequest(res, message) {
  return res.status(400).json({ data: null, error: { code: "bad_request", message } });
}

function toBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function serializeDataset(dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    rowCount: dataset.rowCount,
    columns: dataset.columns,
    dateRangeMin: dataset.dateRangeMin,
    dateRangeMax: dataset.dateRangeMax,
    qualityFlags: dataset.qualityFlags,
  };
}

/**
 * POST /api/datasets — upload a CSV, parse + profile it, persist the
 * dataset + file, and return the profile.
 */
router.post("/", (req, res) => {
  upload.single("file")(req, res, async (multerErr) => {
    if (multerErr) {
      if (multerErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          data: null,
          error: { code: "file_too_large", message: "File exceeds the 100MB upload limit." },
        });
      }
      return badRequest(res, `Upload failed: ${multerErr.message}`);
    }

    if (!req.user || !req.user.id) return unauthorized(res);

    const file = req.file;
    if (!file) return badRequest(res, "No file attached.");

    const filename = file.originalname || "";
    const looksLikeCsv =
      /\.csv$/i.test(filename) ||
      /^(text\/csv|application\/vnd\.ms-excel|application\/csv|text\/plain)$/i.test(file.mimetype || "");
    if (!looksLikeCsv) {
      return badRequest(res, "Uploaded file must be a CSV (wrong content type).");
    }

    if (file.size === 0) {
      return badRequest(res, "Uploaded CSV is empty.");
    }

    const excludeBadRows = toBoolean(req.body ? req.body.excludeBadRows : false);
    const datasetName = (req.body && req.body.name) || filename || "Untitled dataset";

    let parsed;
    try {
      parsed = await parseCsvBuffer(file.buffer);
    } catch (err) {
      req.log?.error?.({ err: err.message }, "csv parse failed");
      console.error("[datasets] CSV structure unrecoverable:", err.message);
      return res.status(422).json({
        data: null,
        error: { code: "unparseable_csv", message: "Malformed CSV structure could not be parsed." },
      });
    }

    if (parsed.rows.length === 0) {
      return badRequest(res, "Uploaded CSV has a header row but no data rows.");
    }

    const profile = computeProfile(parsed, { excludeBadRows });
    const datasetId = randomUUID();

    let savedFile;
    try {
      savedFile = saveDatasetFile(datasetId, filename, file.buffer);
    } catch (err) {
      req.log?.error?.({ err: err.message }, "disk write failed");
      console.error("[datasets] disk write failed:", err.message);
      return res.status(500).json({
        data: null,
        error: { code: "internal_error", message: "Failed to store uploaded file." },
      });
    }

    const transaction = await db.sequelize.transaction();
    try {
      const dataset = await db.Dataset.create(
        {
          id: datasetId,
          name: datasetName,
          createdByUserId: req.user.id,
          rowCount: profile.rowCount,
          columns: profile.columns,
          dateRangeMin: profile.dateRangeMin,
          dateRangeMax: profile.dateRangeMax,
          qualityFlags: profile.qualityFlags,
        },
        { transaction }
      );

      await db.DatasetFile.create(
        {
          id: randomUUID(),
          datasetId,
          originalFilename: filename,
          filePath: savedFile.filePath,
          fileSizeBytes: savedFile.fileSizeBytes,
          rowCount: profile.rowCount,
        },
        { transaction }
      );

      await transaction.commit();

      req.log?.info?.(
        { datasetId, rowCount: profile.rowCount, qualityFlagCount: profile.qualityFlags.length },
        "dataset uploaded"
      );

      return res.status(201).json({ data: serializeDataset(dataset), error: null });
    } catch (err) {
      await transaction.rollback();
      removeDatasetDirectory(datasetId);
      req.log?.error?.({ err: err.message }, "dataset persistence failed");
      console.error("[datasets] DB write failed:", err.message);
      return res.status(500).json({
        data: null,
        error: { code: "internal_error", message: "Failed to save dataset." },
      });
    }
  });
});

/**
 * GET /api/datasets — list all datasets (no per-user isolation in Phase 1/2).
 */
router.get("/", async (req, res) => {
  if (!req.user || !req.user.id) return unauthorized(res);

  try {
    const datasets = await db.Dataset.findAll({ order: [["createdAt", "DESC"]] });
    return res.status(200).json({
      data: datasets.map((d) => ({
        id: d.id,
        name: d.name,
        rowCount: d.rowCount,
        createdAt: d.createdAt,
      })),
      error: null,
    });
  } catch (err) {
    req.log?.error?.({ err: err.message }, "dataset list failed");
    console.error("[datasets] list failed:", err.message);
    return res.status(500).json({ data: null, error: { code: "internal_error", message: "Failed to list datasets." } });
  }
});

/**
 * GET /api/datasets/:id/profile — return the stored profile for a dataset.
 */
router.get("/:id/profile", async (req, res) => {
  if (!req.user || !req.user.id) return unauthorized(res);

  try {
    const dataset = await db.Dataset.findByPk(req.params.id);
    if (!dataset) {
      return res.status(404).json({ data: null, error: { code: "not_found", message: "Dataset not found." } });
    }
    return res.status(200).json({ data: serializeDataset(dataset), error: null });
  } catch (err) {
    req.log?.error?.({ err: err.message }, "dataset profile fetch failed");
    console.error("[datasets] profile fetch failed:", err.message);
    return res.status(500).json({ data: null, error: { code: "internal_error", message: "Failed to fetch profile." } });
  }
});

module.exports = router;
