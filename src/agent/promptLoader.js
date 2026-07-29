"use strict";

/** Loads a system-prompt .md template from src/prompts/ and caches it in memory. */

const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "..", "prompts");
const _cache = new Map();

function loadPrompt(name) {
  if (_cache.has(name)) return _cache.get(name);
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  const text = fs.readFileSync(filePath, "utf8");
  _cache.set(name, text);
  return text;
}

module.exports = { loadPrompt };
