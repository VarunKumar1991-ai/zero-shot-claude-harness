"use strict";

const path = require("path");
const fs = require("fs");
import { beforeAll, afterAll, describe, expect, test } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "..", "..", "..", "data", "test_db_models.sqlite");

// Point the config module at an isolated on-disk SQLite file for this test run,
// via the real AGENT_DATABASE_URL parsing path (not a mock), then load the
// real models against it.
process.env.AGENT_DATABASE_URL = `sqlite:${TEST_DB_PATH.replace(/\\/g, "/")}`;

// eslint-disable-next-line import/no-dynamic-require
const db = require("../../../src/db/models/index.js");

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  await db.sequelize.sync({ force: true });
});

afterAll(async () => {
  await db.sequelize.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

describe("model registry", () => {
  test("loads all five Phase 1 models", () => {
    expect(Object.keys(db)).toEqual(
      expect.arrayContaining(["User", "Dataset", "DatasetFile", "Query", "Annotation"])
    );
  });

  test("maps each model to its documented table name", () => {
    expect(db.User.getTableName()).toBe("users");
    expect(db.Dataset.getTableName()).toBe("datasets");
    expect(db.DatasetFile.getTableName()).toBe("dataset_files");
    expect(db.Query.getTableName()).toBe("queries");
    expect(db.Annotation.getTableName()).toBe("annotations");
  });
});

describe("User model", () => {
  test("creates a user with a bcrypt-shaped password hash and rejects duplicate usernames", async () => {
    const user = await db.User.create({
      username: "unit.test.officer",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
      displayName: "Unit Test Officer",
    });

    expect(user.id).toBeTruthy();
    expect(user.username).toBe("unit.test.officer");

    await expect(
      db.User.create({
        username: "unit.test.officer",
        passwordHash: "$2b$10$anotherhash000000000000",
      })
    ).rejects.toThrow();
  });

  test("requires a username (error path)", async () => {
    await expect(
      db.User.create({
        passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
      })
    ).rejects.toThrow();
  });
});

describe("Dataset model + associations", () => {
  test("associates a dataset to its creating user and its files, and stores JSON columns", async () => {
    const owner = await db.User.create({
      username: "unit.test.owner",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });

    const dataset = await db.Dataset.create({
      name: "June FIRs",
      createdByUserId: owner.id,
      rowCount: 500,
      columns: [{ name: "offence_type", inferredType: "string" }],
      qualityFlags: [{ type: "missing_date", count: 3, sampleRowRefs: [10, 20, 30] }],
    });

    await db.DatasetFile.create({
      datasetId: dataset.id,
      originalFilename: "june.csv",
      filePath: `storage/datasets/${dataset.id}/june.csv`,
      fileSizeBytes: 12345,
      rowCount: 500,
    });

    const reloaded = await db.Dataset.findByPk(dataset.id, { include: ["files", "createdBy"] });

    expect(reloaded.createdBy.id).toBe(owner.id);
    expect(reloaded.files).toHaveLength(1);
    expect(reloaded.files[0].originalFilename).toBe("june.csv");
    expect(reloaded.columns).toEqual([{ name: "offence_type", inferredType: "string" }]);
    expect(reloaded.qualityFlags[0].type).toBe("missing_date");
  });

  test("defaults JSON columns/qualityFlags to empty arrays when not supplied (edge case)", async () => {
    const owner = await db.User.create({
      username: "unit.test.owner.defaults",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });

    const dataset = await db.Dataset.create({
      name: "Empty profile dataset",
      createdByUserId: owner.id,
    });

    expect(dataset.columns).toEqual([]);
    expect(dataset.qualityFlags).toEqual([]);
    expect(dataset.rowCount).toBe(0);
  });

  test("rejects a dataset with no createdByUserId (error path)", async () => {
    await expect(
      db.Dataset.create({
        name: "Orphan dataset",
      })
    ).rejects.toThrow();
  });
});

describe("Query model (audit log)", () => {
  test("persists a full audit record with generated code, result, and token usage", async () => {
    const owner = await db.User.create({
      username: "unit.test.analyst",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });
    const dataset = await db.Dataset.create({
      name: "Audit dataset",
      createdByUserId: owner.id,
    });

    const query = await db.Query.create({
      datasetId: dataset.id,
      userId: owner.id,
      sessionId: "session-1",
      question: "How many thefts were reported in June?",
      generatedCode: "rows.filter(r => r.offence_type === 'theft').length",
      result: { count: 42 },
      answer: "There were 42 thefts reported in June.",
      keyNumbers: [{ label: "Theft count", value: 42 }],
      tokenUsage: { promptTokens: 120, completionTokens: 30 },
      status: "completed",
      completedAt: new Date(),
    });

    const reloaded = await db.Query.findByPk(query.id, { include: ["dataset", "user"] });

    expect(reloaded.dataset.id).toBe(dataset.id);
    expect(reloaded.user.id).toBe(owner.id);
    expect(reloaded.result).toEqual({ count: 42 });
    expect(reloaded.keyNumbers).toEqual([{ label: "Theft count", value: 42 }]);
    expect(reloaded.tokenUsage).toEqual({ promptTokens: 120, completionTokens: 30 });
    expect(reloaded.attempts).toEqual([]);
    expect(reloaded.followups).toEqual([]);
    expect(reloaded.status).toBe("completed");
  });

  test("persists a failed query with an error and no result (error path)", async () => {
    const owner = await db.User.create({
      username: "unit.test.analyst.fail",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });
    const dataset = await db.Dataset.create({
      name: "Failing audit dataset",
      createdByUserId: owner.id,
    });

    const query = await db.Query.create({
      datasetId: dataset.id,
      userId: owner.id,
      sessionId: "session-2",
      question: "What is the meaning of life?",
      status: "failed",
      error: "Could not generate a valid analysis for this question.",
    });

    expect(query.result == null).toBe(true);
    expect(query.status).toBe("failed");
    expect(query.error).toContain("Could not generate");
  });

  test("rejects a query with no question text (edge case)", async () => {
    const owner = await db.User.create({
      username: "unit.test.analyst.empty",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });
    const dataset = await db.Dataset.create({
      name: "Empty question dataset",
      createdByUserId: owner.id,
    });

    await expect(
      db.Query.create({
        datasetId: dataset.id,
        userId: owner.id,
        sessionId: "session-3",
        status: "completed",
      })
    ).rejects.toThrow();
  });
});

describe("Annotation model (Phase 2 stub, empty in Phase 1)", () => {
  test("table exists and accepts a row shaped per data.md, even though unused in Phase 1", async () => {
    const owner = await db.User.create({
      username: "unit.test.annotator",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuv",
    });
    const dataset = await db.Dataset.create({
      name: "Annotatable dataset",
      createdByUserId: owner.id,
    });

    const annotation = await db.Annotation.create({
      datasetId: dataset.id,
      createdByUserId: owner.id,
      columnName: "IPC_Section",
      note: "IPC_Section = offence code",
    });

    expect(annotation.id).toBeTruthy();
    expect(annotation.note).toBe("IPC_Section = offence code");
  });
});
