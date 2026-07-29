"use strict";

/**
 * Auth service — password verification and JWT session issuance/verification.
 *
 * Field names match the `User` model in `src/db/models/user.js` (per
 * `spec/data.md`'s User entity): `username`, `passwordHash`, `displayName`.
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { User } = require("../db/models");

const SESSION_COOKIE_NAME = "session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h, per spec/api.md

/**
 * Reads AGENT_JWT_SECRET from the environment. Fails loudly (no silent
 * fallback) if it is absent — a session-signing secret must never be guessed
 * or defaulted in a way that would silently accept a forged token.
 */
function getJwtSecret() {
  const secret = process.env.AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "AGENT_JWT_SECRET is not set. Add AGENT_JWT_SECRET=<a-random-secret-value> to your .env file " +
        "(see .env.example) before starting the server — session tokens cannot be signed without it."
    );
  }
  return secret;
}

/**
 * Pure password check — given an already-fetched user (or null/undefined)
 * and a plaintext password, returns true only if the user exists, has a
 * password hash, and the password matches it. Kept separate from the
 * `User.findOne` DB lookup so it can be unit-tested without a database.
 */
async function checkPassword(user, password) {
  if (!user || !user.passwordHash || !password) {
    return false;
  }
  return bcrypt.compare(password, user.passwordHash);
}

/**
 * Verifies a username/password pair against the `users` table.
 * Returns the Sequelize User instance on success, or null on any failure
 * (unknown username, wrong password, missing input) — callers should treat
 * every null the same way (401 Incorrect username or password) to avoid
 * leaking which case occurred.
 */
async function verifyCredentials(username, password) {
  if (!username || !password) {
    return null;
  }

  const user = await User.findOne({ where: { username } });
  const isValid = await checkPassword(user, password);
  if (!isValid) {
    return null;
  }

  return user;
}

/**
 * Issues a signed JWT session token for a given user, valid for
 * SESSION_TTL_SECONDS.
 */
function issueSessionToken(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      displayName: user.displayName ?? null,
    },
    secret,
    { expiresIn: SESSION_TTL_SECONDS }
  );
}

/**
 * Verifies a session JWT. Returns the decoded payload on success, or null
 * if the token is missing, malformed, expired, or signed with a different
 * secret.
 */
function verifySessionToken(token) {
  if (!token) {
    return null;
  }
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

/** Shapes a User model instance into the public response shape from api.md. */
function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  getJwtSecret,
  checkPassword,
  verifyCredentials,
  issueSessionToken,
  verifySessionToken,
  toPublicUser,
};
