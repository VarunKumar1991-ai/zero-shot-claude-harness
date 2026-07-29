"use strict";

/**
 * sandboxExecute({ code, rows }, options?) -> Promise<{ result, stdout, error, durationMs }>
 *
 * Runs LLM-generated JS in an isolated `worker_thread` (see workerScript.js
 * for the vm.Context isolation itself). This is the ONLY place the parent
 * process ever spawns a worker for code execution — one fresh, throwaway
 * worker per call, terminated immediately after it reports back or times out.
 *
 * Guarantees:
 *   - Hard wall-clock timeout (`options.timeoutMs`, default 5000ms) enforced
 *     from the PARENT via `worker.terminate()` — a backstop independent of
 *     the worker's own internal `vm.Script` timeout, so a worker that never
 *     posts a message (e.g. stuck in native code) is still killed.
 *   - Memory ceiling via `resourceLimits.maxOldGenerationSizeMb`
 *     (default 256MB, configurable) — a runaway allocation kills the worker,
 *     not the server process.
 *   - Never throws — always resolves to `{ result, stdout, error, durationMs }`
 *     so callers (execute_code node) can uniformly reason about success/failure.
 */

const { Worker } = require("worker_threads");
const path = require("path");

const WORKER_SCRIPT_PATH = path.join(__dirname, "workerScript.js");

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_OLD_GEN_MB = 256;

function sandboxExecute({ code, rows }, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxOldGenerationSizeMb = options.maxOldGenerationSizeMb || DEFAULT_MAX_OLD_GEN_MB;
  const vmTimeoutMs = Math.max(500, timeoutMs - 500);

  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let worker;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      if (worker) {
        worker.terminate().catch(() => {});
      }
      resolve({
        result: payload.result,
        stdout: payload.stdout || [],
        error: payload.error || null,
        durationMs,
      });
    };

    const timer = setTimeout(() => {
      finish({ result: undefined, stdout: [], error: `execution timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    try {
      worker = new Worker(WORKER_SCRIPT_PATH, {
        workerData: { code: String(code || ""), rows: Array.isArray(rows) ? rows : [], vmTimeoutMs },
        resourceLimits: { maxOldGenerationSizeMb },
        // No stdin/stdout/stderr wiring, no eval, no extra execArgv — the
        // worker has no side channel to the parent except postMessage.
      });
    } catch (err) {
      finish({ result: undefined, stdout: [], error: `failed to start sandbox worker: ${err.message}` });
      return;
    }

    worker.once("message", (msg) => finish(msg || {}));

    worker.once("error", (err) => {
      finish({ result: undefined, stdout: [], error: err && err.message ? err.message : String(err) });
    });

    worker.once("exit", (exitCode) => {
      // If we already settled via message/error/timeout, this is a no-op.
      if (exitCode !== 0) {
        finish({ result: undefined, stdout: [], error: `sandbox worker exited with code ${exitCode}` });
      } else {
        finish({ result: undefined, stdout: [], error: "sandbox worker exited before reporting a result" });
      }
    });
  });
}

module.exports = { sandboxExecute, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OLD_GEN_MB };
