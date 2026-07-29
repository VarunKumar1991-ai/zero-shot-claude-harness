"use strict";

/**
 * Express middleware: verifies the httpOnly `session` JWT cookie and attaches
 * `req.user` on success. Responds 401 (per spec/api.md's response envelope)
 * if the cookie is missing or the token is invalid/expired.
 */

const { SESSION_COOKIE_NAME, verifySessionToken } = require("../services/authService");

function requireSession(req, res, next) {
  const token = req.cookies ? req.cookies[SESSION_COOKIE_NAME] : undefined;

  if (!token) {
    return res.status(401).json({
      data: null,
      error: { code: "unauthorized", message: "Not logged in." },
    });
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    return res.status(401).json({
      data: null,
      error: { code: "unauthorized", message: "Session invalid or expired." },
    });
  }

  req.user = {
    id: payload.sub,
    username: payload.username,
    displayName: payload.displayName ?? null,
  };

  next();
}

module.exports = { requireSession };
