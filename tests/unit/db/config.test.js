"use strict";

const path = require("path");
import { describe, expect, test } from "vitest";

const { resolveStoragePath } = require("../../../src/db/config.js");

describe("resolveStoragePath", () => {
  test("resolves the Sequelize-style relative form (sqlite:./data/agent.db)", () => {
    expect(resolveStoragePath("sqlite:./data/agent.db")).toBe(
      path.resolve("./data/agent.db")
    );
  });

  test("resolves the SQLAlchemy-style URL form (sqlite:///./data/agent.db) (edge case)", () => {
    expect(resolveStoragePath("sqlite:///./data/agent.db")).toBe(
      path.resolve("./data/agent.db")
    );
  });

  test("falls back to data/agent.db when no URL is supplied (error/edge path)", () => {
    expect(resolveStoragePath(undefined)).toBe(path.resolve("data", "agent.db"));
    expect(resolveStoragePath("")).toBe(path.resolve("data", "agent.db"));
  });
});
