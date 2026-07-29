"use strict";

require("dotenv").config();

const path = require("path");

/**
 * Resolve the on-disk SQLite storage path from AGENT_DATABASE_URL.
 *
 * Accepts both the Node/Sequelize-style relative form (`sqlite:./data/agent.db`)
 * and the Python/SQLAlchemy-style URL form (`sqlite:///./data/agent.db`), since
 * `.env` may carry either depending on how it was seeded. Falls back to
 * `data/agent.db` if the env var is unset.
 */
function resolveStoragePath(databaseUrl) {
  if (!databaseUrl) {
    return path.resolve("data", "agent.db");
  }

  const withoutScheme = databaseUrl.replace(/^sqlite:/, "");
  // Collapse any run of leading slashes (URL-authority style) down to a single one.
  const normalized = withoutScheme.replace(/^\/{2,}/, "/");
  const relativeOrAbsolute = normalized.startsWith("/") ? normalized.slice(1) : normalized;

  return path.resolve(relativeOrAbsolute);
}

const storage = resolveStoragePath(process.env.AGENT_DATABASE_URL);

const base = {
  dialect: "sqlite",
  storage,
  logging: false,
};

module.exports = {
  development: base,
  test: base,
  production: base,
  resolveStoragePath,
};
