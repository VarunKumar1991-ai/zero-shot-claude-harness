"use strict";

/**
 * Given parsed rows from csvParser, compute the dataset profile: column
 * list + inferred types, row count, date range (min/max across every
 * detected date column), and the quality-flag summary. Pure function of its
 * inputs — no I/O, no DB, no HTTP concerns.
 */

/**
 * @param {object} parsed - output of csvParser.parseCsvFile/parseCsvBuffer
 * @param {object} [options]
 * @param {boolean} [options.excludeBadRows] - if true, rows carrying any
 *   quality issue are excluded from the persisted row count / date range
 *   (the officer's explicit confirmation, per the upload contract).
 * @returns {{
 *   columns: {name: string, inferredType: string}[],
 *   rowCount: number,
 *   dateRangeMin: string|null,
 *   dateRangeMax: string|null,
 *   qualityFlags: {type: string, count: number, sampleRowRefs: number[]}[],
 *   includedRows: object[],
 *   excludedRowCount: number,
 * }}
 */
function computeProfile(parsed, options = {}) {
  const { excludeBadRows = false } = options;
  const { columns, rows, qualityIssues } = parsed;

  const includedRows = excludeBadRows ? rows.filter((r) => r.__issues.length === 0) : rows;
  const excludedRowCount = rows.length - includedRows.length;

  const dateColumns = columns.filter((c) => c.inferredType === "date").map((c) => c.name);

  let dateRangeMin = null;
  let dateRangeMax = null;
  for (const row of includedRows) {
    for (const col of dateColumns) {
      const value = row[col];
      if (!value) continue;
      if (dateRangeMin === null || value < dateRangeMin) dateRangeMin = value;
      if (dateRangeMax === null || value > dateRangeMax) dateRangeMax = value;
    }
  }

  return {
    columns,
    rowCount: includedRows.length,
    dateRangeMin,
    dateRangeMax,
    qualityFlags: qualityIssues,
    includedRows,
    excludedRowCount,
  };
}

module.exports = { computeProfile };
