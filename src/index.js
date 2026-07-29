"use strict";

/**
 * Express app entrypoint — UP Police Data Analyst Agent backend.
 *
 * This file is shared by multiple build slices: each slice mounts its own
 * router additively under `/api/*`. Keep router-mounting disjoint (one line
 * per slice, one router import per slice) so concurrent edits stay low-
 * conflict. The frontend is served from the single origin at `/app` once the
 * frontend-shell slice lands its static export; until then a placeholder
 * response is served so the app boots cleanly end to end.
 */

require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");

const path = require("path");
const fs = require("fs");

const authRouter = require("./routes/auth");
const datasetsRouter = require("./routes/datasets");
const queriesRouter = require("./routes/queries");
const { requireSession } = require("./middleware/session");

const app = express();

app.use(express.json());
app.use(cookieParser());

// --- API routes (additive — each slice owns one line here) ---
app.use("/api/auth", authRouter);
app.use("/api/datasets", requireSession, datasetsRouter);
// queriesRouter scopes its own /:id/queries sub-paths so it mounts cleanly
// at the same /api/datasets base as datasetsRouter without shadowing it.
app.use("/api/datasets", requireSession, queriesRouter);

// --- Frontend static mount: Next.js `output: 'export'` build at frontend/out ---
// Single-origin :8001/app deployment model (architecture.md). The static
// export bakes basePath: '/app' into every asset URL already, so we mount
// the exported directory at /app and let express.static resolve
// extensionless, trailing-slash routes (trailingSlash: true in
// frontend/next.config.ts) to their <route>/index.html file.
const FRONTEND_OUT_DIR = path.join(__dirname, "..", "frontend", "out");
const frontendBuilt = fs.existsSync(FRONTEND_OUT_DIR);

if (frontendBuilt) {
  app.use(
    "/app",
    express.static(FRONTEND_OUT_DIR, {
      extensions: ["html"],
      // Do not auto-serve /app/index.html for every unmatched path — the
      // catch-all fallback below handles direct loads of unknown/dynamic
      // routes explicitly, distinguishing "real page" from "true 404".
      redirect: false,
    })
  );

  // Direct-load fallback for client-side dynamic routes (e.g.
  // /app/datasets/<uuid>/ — see frontend/src/app/datasets/[id]/page.tsx,
  // which renders its content purely from the live browser URL after
  // hydration, so any id resolves to the same pre-rendered HTML shell).
  app.get("/app/datasets/*", (req, res, next) => {
    // `next build` (output: 'export') emits the dynamic [id] route's single
    // generateStaticParams() result under its literal param value
    // (out/datasets/placeholder/index.html) — see
    // frontend/src/app/datasets/[id]/page.tsx's comment: any id resolves to
    // this same pre-rendered shell, which derives the real id client-side
    // from the live browser URL after hydration.
    const shellPath = path.join(FRONTEND_OUT_DIR, "datasets", "placeholder", "index.html");
    if (fs.existsSync(shellPath)) {
      return res.sendFile(shellPath);
    }
    return next();
  });

  app.get("/app", (req, res) => {
    res.sendFile(path.join(FRONTEND_OUT_DIR, "index.html"));
  });

  app.get("/app/*", (req, res) => {
    res.status(404).type("text/plain").send("Not found.");
  });
} else {
  const FRONTEND_NOT_READY_MESSAGE =
    "UP Police Data Analyst Agent — frontend not yet built. Run `cd frontend && npm install && npm run build` to produce frontend/out.";

  app.get("/app", (req, res) => {
    res.type("text/plain").send(FRONTEND_NOT_READY_MESSAGE);
  });
  app.get("/app/*", (req, res) => {
    res.type("text/plain").send(FRONTEND_NOT_READY_MESSAGE);
  });
}

const PORT = process.env.PORT || 8001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`UP Police Data Analyst Agent backend listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
