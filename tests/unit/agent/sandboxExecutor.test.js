import { describe, it, expect } from "vitest";
import { sandboxExecute } from "../../../src/agent/sandbox/executor.js";

describe("sandboxExecute — security boundary", () => {
  it("computes a correct normal rows.filter(...) result", async () => {
    const rows = [
      { offenceType: "theft" },
      { offenceType: "assault" },
      { offenceType: "theft" },
      { offenceType: "theft" },
    ];
    const res = await sandboxExecute({
      code: 'result = rows.filter(r => r.offenceType === "theft").length;',
      rows,
    });
    expect(res.error).toBeNull();
    expect(res.result).toBe(3);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("kills a while(true){} infinite loop via the hard timeout", async () => {
    const res = await sandboxExecute({ code: "while(true){}", rows: [] }, { timeoutMs: 1500 });
    expect(res.result).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(res.error.toLowerCase()).toMatch(/timed out/);
    // Must resolve close to the configured timeout, not hang indefinitely.
    expect(res.durationMs).toBeLessThan(3000);
  }, 10000);

  it("blocks require('fs') — no filesystem access from generated code", async () => {
    const res = await sandboxExecute(
      { code: 'result = require("fs").readFileSync("/etc/passwd", "utf8");', rows: [] }
    );
    expect(res.result).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(res.error.toLowerCase()).toContain("require is not defined");
  });

  it("blocks process access — process.exit() cannot reach the parent", async () => {
    const res = await sandboxExecute({ code: "process.exit(1); result = 999;", rows: [] });
    expect(res.result).toBeUndefined();
    expect(res.error).toBeTruthy();
    expect(res.error.toLowerCase()).toContain("process is not defined");
  });

  it("blocks fetch/network globals", async () => {
    const res = await sandboxExecute({ code: 'result = typeof fetch === "undefined" ? "blocked" : "leaked";', rows: [] });
    expect(res.error).toBeNull();
    expect(res.result).toBe("blocked");
  });

  it("exposes the whitelisted helpers object (sum, mean, median, groupBy, parseDate)", async () => {
    const res = await sandboxExecute({
      code: "result = { s: helpers.sum([1,2,3]), m: helpers.mean([2,4]), md: helpers.median([1,2,3]) };",
      rows: [],
    });
    expect(res.error).toBeNull();
    expect(res.result).toEqual({ s: 6, m: 3, md: 2 });
  });

  it("captures a thrown exception in generated code as an error, not a crash", async () => {
    const res = await sandboxExecute({ code: "throw new Error('bad analysis logic');", rows: [] });
    expect(res.result).toBeUndefined();
    expect(res.error).toContain("bad analysis logic");
  });

  it("does not leak state between two separate executions (fresh worker per call)", async () => {
    await sandboxExecute({ code: "result = (globalThis.leak = 42);", rows: [] });
    const res2 = await sandboxExecute({ code: 'result = typeof globalThis.leak === "undefined" ? "clean" : "leaked";', rows: [] });
    expect(res2.result).toBe("clean");
  });
});
