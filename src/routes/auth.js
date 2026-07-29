"use strict";

/**
 * Auth routes — POST /login, POST /logout, GET /me.
 * Mounted at /api/auth in src/index.js. Contract: spec/api.md.
 */

const express = require("express");
const authService = require("../services/authService");
const { requireSession } = require("../middleware/session");

const router = express.Router();

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: authService.SESSION_TTL_SECONDS * 1000,
    path: "/",
  };
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      data: null,
      error: { code: "bad_request", message: "Missing username or password." },
    });
  }

  try {
    const user = await authService.verifyCredentials(username, password);
    if (!user) {
      return res.status(401).json({
        data: null,
        error: { code: "unauthorized", message: "Incorrect username or password." },
      });
    }

    const token = authService.issueSessionToken(user);
    res.cookie(authService.SESSION_COOKIE_NAME, token, cookieOptions());

    return res.status(200).json({ data: authService.toPublicUser(user), error: null });
  } catch (err) {
    req.log?.error?.({ err }, "login failed");
    console.error("[auth] login failed:", err);
    return res.status(500).json({
      data: null,
      error: { code: "internal_error", message: "Internal error during login." },
    });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(authService.SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res.status(200).json({ data: { loggedOut: true }, error: null });
});

router.get("/me", requireSession, (req, res) => {
  return res.status(200).json({ data: req.user, error: null });
});

module.exports = router;
