"use strict";

/**
 * Whitelisted helper functions exposed inside the LLM-generated-code sandbox
 * (see src/agent/sandbox/workerScript.js and spec/architecture.md's
 * "Sandboxed code execution" section). Pure functions only — no I/O, no
 * closures over anything outside their own arguments — so they are safe to
 * hand into a vm.Context without leaking any Node capability.
 */

function sum(arr) {
  if (!Array.isArray(arr)) return 0;
  let total = 0;
  for (const v of arr) {
    const n = Number(v);
    if (!Number.isNaN(n)) total += n;
  }
  return total;
}

function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const nums = arr.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}

/**
 * Groups an array of objects by the value returned by keyFn, returning a
 * plain object of key -> array-of-items (not a Map, so it structured-clones
 * cleanly back to the parent process).
 */
function groupBy(arr, keyFn) {
  if (!Array.isArray(arr) || typeof keyFn !== "function") return {};
  const out = {};
  for (const item of arr) {
    const key = String(keyFn(item));
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

/**
 * Parses a value into a Date, tolerant of common CSV date formats
 * (ISO, DD/MM/YYYY, DD-MM-YYYY). Returns null (never throws) if unparseable.
 */
function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();

  const isoAttempt = new Date(str);
  if (!Number.isNaN(isoAttempt.getTime()) && /\d{4}-\d{2}-\d{2}/.test(str)) {
    return isoAttempt;
  }

  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return Number.isNaN(isoAttempt.getTime()) ? null : isoAttempt;
}

module.exports = { sum, mean, median, groupBy, parseDate };
