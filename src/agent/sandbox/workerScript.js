"use strict";

/**
 * Worker-thread entry point spawned by src/agent/sandbox/executor.js.
 *
 * SECURITY BOUNDARY: this file runs inside a dedicated `worker_thread`. It
 * builds a fresh `vm.Context` exposing ONLY:
 *   - `rows`        (the parsed dataset for this run)
 *   - `helpers`      ({ sum, mean, median, groupBy, parseDate })
 *   - standard JS built-ins that `vm.createContext` provides fresh for the
 *     new realm (Array, Object, Math, Date, JSON, Set, Map, String, Number, ...)
 *   - a no-op-capturing `console.log`
 *
 * It never exposes `require`, `process`, `fs`, `fetch`, `http`, `module`,
 * `global`/`globalThis` of the worker's own realm, or any other Node
 * capability to the sandboxed context. `vm.createContext` builds a brand
 * new global object for the sandbox realm — Node globals from the worker's
 * own scope are simply never copied into it, so referencing them from
 * generated code throws a ReferenceError inside the sandbox and can never
 * reach the parent process, the filesystem, or the network.
 *
 * Communication with the parent is exclusively via `parentPort.postMessage`
 * (structured clone) — no shared memory, no other IPC channel.
 */

const { workerData, parentPort } = require("worker_threads");
const vm = require("vm");
const helpers = require("./helpers");

const DEFAULT_VM_TIMEOUT_MS = 4500;

function main() {
  const { code, rows, vmTimeoutMs } = workerData || {};
  const stdout = [];

  const sandbox = Object.create(null);
  sandbox.rows = Array.isArray(rows) ? rows : [];
  sandbox.helpers = Object.freeze({ ...helpers });
  sandbox.result = undefined;
  sandbox.console = Object.freeze({
    log: (...args) => {
      try {
        stdout.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      } catch {
        stdout.push(String(args));
      }
    },
  });

  let context;
  try {
    context = vm.createContext(sandbox, {
      name: "up-police-analysis-sandbox",
      codeGeneration: { strings: false, wasm: false },
    });
  } catch (err) {
    parentPort.postMessage({
      result: undefined,
      stdout,
      error: `sandbox context creation failed: ${err && err.message ? err.message : String(err)}`,
    });
    return;
  }

  try {
    const script = new vm.Script(String(code || ""), { filename: "generated-analysis.js" });
    script.runInContext(context, { timeout: vmTimeoutMs || DEFAULT_VM_TIMEOUT_MS });
    parentPort.postMessage({ result: context.result, stdout, error: null });
  } catch (err) {
    parentPort.postMessage({
      result: undefined,
      stdout,
      error: err && err.message ? err.message : String(err),
    });
  }
}

main();
