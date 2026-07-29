import { describe, it, expect, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";
import * as authService from "../../../src/services/authService.js";

// Note: `verifyCredentials`'s DB-lookup happy/error paths (unknown username,
// real seeded user, wrong password against a real row) are covered by the
// real-DB integration test (tests/integration/auth.test.js) rather than
// mocked here — mocking Sequelize's `require("../db/models")` from a
// CommonJS module is brittle to fake convincingly, and a real SQLite lookup
// is a more faithful test anyway. This file covers the pure, DB-free logic:
// password checking, JWT issuance/verification, and response shaping.

describe("authService", () => {
  const ORIGINAL_SECRET = process.env.AGENT_JWT_SECRET;

  beforeEach(() => {
    process.env.AGENT_JWT_SECRET = "test-secret-for-unit-tests-only";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.AGENT_JWT_SECRET;
    } else {
      process.env.AGENT_JWT_SECRET = ORIGINAL_SECRET;
    }
  });

  describe("getJwtSecret", () => {
    it("throws a clear, actionable error when AGENT_JWT_SECRET is unset", () => {
      delete process.env.AGENT_JWT_SECRET;
      expect(() => authService.getJwtSecret()).toThrow(/AGENT_JWT_SECRET/);
      expect(() => authService.getJwtSecret()).toThrow(/\.env/);
    });

    it("returns the configured secret when set", () => {
      expect(authService.getJwtSecret()).toBe("test-secret-for-unit-tests-only");
    });
  });

  describe("checkPassword", () => {
    it("returns true for a matching password against a stored hash (happy path)", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      const user = { id: "u1", username: "officer1", passwordHash };
      expect(await authService.checkPassword(user, "correct-password")).toBe(true);
    });

    it("returns false for a non-matching password (error path)", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      const user = { id: "u1", username: "officer1", passwordHash };
      expect(await authService.checkPassword(user, "wrong-password")).toBe(false);
    });

    it("returns false for a null user or missing password (edge case)", async () => {
      expect(await authService.checkPassword(null, "whatever")).toBe(false);
      expect(await authService.checkPassword(undefined, "whatever")).toBe(false);
      const passwordHash = await bcrypt.hash("correct-password", 10);
      expect(await authService.checkPassword({ passwordHash }, "")).toBe(false);
      expect(await authService.checkPassword({ passwordHash: null }, "correct-password")).toBe(false);
    });
  });

  describe("verifyCredentials", () => {
    it("returns null without touching the DB when username or password is missing (edge case)", async () => {
      expect(await authService.verifyCredentials("", "pw")).toBeNull();
      expect(await authService.verifyCredentials("user", "")).toBeNull();
      expect(await authService.verifyCredentials(undefined, undefined)).toBeNull();
    });
  });

  describe("issueSessionToken / verifySessionToken", () => {
    it("round-trips a valid token (happy path)", () => {
      const user = { id: "u1", username: "officer1", displayName: "Insp. Rao" };
      const token = authService.issueSessionToken(user);
      const payload = authService.verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload.sub).toBe("u1");
      expect(payload.username).toBe("officer1");
      expect(payload.displayName).toBe("Insp. Rao");
    });

    it("returns null for a malformed/tampered token (error path)", () => {
      expect(authService.verifySessionToken("not-a-real-jwt")).toBeNull();
      expect(authService.verifySessionToken("a.b.c")).toBeNull();
    });

    it("returns null for a missing token (edge case)", () => {
      expect(authService.verifySessionToken("")).toBeNull();
      expect(authService.verifySessionToken(undefined)).toBeNull();
    });

    it("returns null for a token signed with a different secret", () => {
      const user = { id: "u1", username: "officer1", displayName: null };
      const token = authService.issueSessionToken(user);
      process.env.AGENT_JWT_SECRET = "a-different-secret";
      expect(authService.verifySessionToken(token)).toBeNull();
    });
  });

  describe("toPublicUser", () => {
    it("shapes a user into the api.md response shape, falling back displayName to username", () => {
      expect(
        authService.toPublicUser({ id: "u1", username: "officer1", displayName: null })
      ).toEqual({ id: "u1", username: "officer1", displayName: "officer1" });
    });

    it("preserves an explicit displayName when present", () => {
      expect(
        authService.toPublicUser({ id: "u1", username: "officer1", displayName: "Insp. Rao" })
      ).toEqual({ id: "u1", username: "officer1", displayName: "Insp. Rao" });
    });
  });
});
