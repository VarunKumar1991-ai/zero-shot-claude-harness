"use strict";

/**
 * Streaming CSV parser: turns a raw CSV stream/buffer into typed row objects,
 * infers a type (string/number/date) per column from a *full-file* scan (not
 * a sample — see spec/capabilities/dataset-upload-and-profiling.md), and
 * detects malformed rows (bad dates, missing "required-looking" values,
 * wrong column count) without ever throwing them away — every malformed row
 * is tagged with its issues and returned, never silently dropped.
 *
 * Never logs full row contents — only counts/summaries (data-residency rule).
 */

const { parse } = require("csv-parse");
const { Readable } = require("stream");
const fs = require("fs");

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

// Fraction of non-empty values in a column that must match a candidate type
// for the whole column to be inferred as that type.
const DATE_TYPE_THRESHOLD = 0.8;
// A column is treated as "required-looking" (missing values get flagged) if
// at least this fraction of rows have a non-empty value in it.
const REQUIRED_FILL_THRESHOLD = 0.9;

/**
 * Strict ISO (YYYY-MM-DD) date validation — rejects both non-matching
 * formats AND calendar-invalid dates that `Date` would otherwise silently
 * roll over (e.g. 2026-02-30 -> 2026-03-02).
 */
function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isNumeric(value) {
  return typeof value === "string" && value.trim() !== "" && NUMBER_RE.test(value.trim());
}

/**
 * Infer a column's type from every non-empty value observed for it across
 * the whole file.
 */
function inferColumnType(values) {
  const nonEmpty = values.filter((v) => v !== undefined && v !== null && String(v).trim() !== "");
  if (nonEmpty.length === 0) return "string";

  if (nonEmpty.every((v) => isNumeric(v))) return "number";

  const dateMatches = nonEmpty.filter((v) => isValidIsoDate(v)).length;
  if (dateMatches / nonEmpty.length >= DATE_TYPE_THRESHOLD) return "date";

  return "string";
}

/**
 * Parse a readable stream of CSV text into raw string rows (array-of-arrays)
 * plus a header row. Never throws on a per-row column-count mismatch —
 * `relax_column_count` lets csv-parse keep going; we detect/flag the
 * mismatch ourselves instead. Genuinely unparseable structure (e.g. no
 * header row could be determined at all) rejects the returned promise so the
 * route can surface a 422.
 */
function parseRawRows(stream) {
  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    const rawRows = [];
    let headers = null;

    parser.on("readable", () => {
      let record;
      // eslint-disable-next-line no-cond-assign
      while ((record = parser.read()) !== null) {
        if (headers === null) {
          headers = record.map((h) => String(h).trim());
        } else {
          rawRows.push(record);
        }
      }
    });

    parser.on("error", (err) => {
      reject(err);
    });

    parser.on("end", () => {
      if (headers === null) {
        reject(new Error("CSV has no header row / could not be parsed"));
        return;
      }
      resolve({ headers, rawRows });
    });

    stream.pipe(parser);
  });
}

/**
 * Build typed row objects + malformed-row detection from raw parsed rows.
 *
 * Returns:
 *  - columns: [{ name, inferredType }]
 *  - rows: [{ __rowIndex, __issues: [{type, column}], <col>: typedValue|null }]
 *  - qualityIssues: [{ type, count, sampleRowRefs }]
 */
function buildTypedRows(headers, rawRows) {
  // Column-major raw string values (for type inference), padding/truncating
  // per row against the header length without ever dropping the row.
  const columnValues = headers.map(() => []);
  const normalizedRows = rawRows.map((record) => {
    const wrongColumnCount = record.length !== headers.length;
    const values = headers.map((_, i) => (i < record.length ? record[i] : ""));
    headers.forEach((_, i) => columnValues[i].push(values[i]));
    return { values, wrongColumnCount };
  });

  const columns = headers.map((name, i) => ({ name, inferredType: inferColumnType(columnValues[i]) }));

  // Required-looking columns: high fill rate -> missing values get flagged.
  const fillRates = headers.map((_, i) => {
    const filled = columnValues[i].filter((v) => String(v).trim() !== "").length;
    return normalizedRows.length === 0 ? 1 : filled / normalizedRows.length;
  });
  const requiredColumns = headers.map((_, i) => fillRates[i] >= REQUIRED_FILL_THRESHOLD);

  const issueCounts = {}; // type -> { count, sampleRowRefs }

  function recordIssue(type, rowIndex) {
    if (!issueCounts[type]) issueCounts[type] = { count: 0, sampleRowRefs: [] };
    issueCounts[type].count += 1;
    if (issueCounts[type].sampleRowRefs.length < 10) {
      issueCounts[type].sampleRowRefs.push(rowIndex);
    }
  }

  const rows = normalizedRows.map((row, idx) => {
    const rowIndex = idx + 1; // 1-based, matches "line N of the data" for officers
    const issues = [];
    const typed = {};

    headers.forEach((name, i) => {
      const raw = row.values[i];
      const isEmpty = raw === undefined || raw === null || String(raw).trim() === "";
      const type = columns[i].inferredType;

      if (isEmpty) {
        typed[name] = null;
        if (requiredColumns[i]) {
          issues.push({ type: "missing_value", column: name });
          recordIssue("missing_value", rowIndex);
        }
        return;
      }

      if (type === "date") {
        if (isValidIsoDate(raw)) {
          typed[name] = raw;
        } else {
          typed[name] = null;
          issues.push({ type: "unparseable_date", column: name });
          recordIssue("unparseable_date", rowIndex);
        }
      } else if (type === "number") {
        typed[name] = isNumeric(raw) ? Number(raw) : null;
        if (!isNumeric(raw)) {
          issues.push({ type: "unparseable_number", column: name });
          recordIssue("unparseable_number", rowIndex);
        }
      } else {
        typed[name] = raw;
      }
    });

    if (row.wrongColumnCount) {
      issues.push({ type: "wrong_column_count", column: null });
      recordIssue("wrong_column_count", rowIndex);
    }

    return { __rowIndex: rowIndex, __issues: issues, ...typed };
  });

  const qualityIssues = Object.entries(issueCounts).map(([type, v]) => ({
    type,
    count: v.count,
    sampleRowRefs: v.sampleRowRefs,
  }));

  return { columns, rows, qualityIssues };
}

/**
 * Parse a CSV file from disk (streaming — never loads the whole file into a
 * single string first) into typed row objects + quality-issue summary.
 */
async function parseCsvFile(filePath) {
  const stream = fs.createReadStream(filePath);
  const { headers, rawRows } = await parseRawRows(stream);
  const { columns, rows, qualityIssues } = buildTypedRows(headers, rawRows);
  return { headers, columns, rows, qualityIssues };
}

/**
 * Parse a CSV from an in-memory Buffer (used by the upload route, which
 * receives the file via multer before it is persisted to disk).
 */
async function parseCsvBuffer(buffer) {
  const stream = Readable.from(buffer);
  const { headers, rawRows } = await parseRawRows(stream);
  const { columns, rows, qualityIssues } = buildTypedRows(headers, rawRows);
  return { headers, columns, rows, qualityIssues };
}

module.exports = {
  parseCsvFile,
  parseCsvBuffer,
  isValidIsoDate,
  isNumeric,
  inferColumnType,
};
