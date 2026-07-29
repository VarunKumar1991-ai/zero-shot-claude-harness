"use strict";

const { sandboxExecute } = require("../sandbox/executor");

async function executeCode(state) {
  const code = state.generatedCode || "";
  const rows = Array.isArray(state.rows) ? state.rows : [];

  let executionResult;
  if (!code.trim()) {
    executionResult = {
      result: undefined,
      stdout: [],
      error: "no code was generated to execute",
      durationMs: 0,
    };
  } else {
    executionResult = await sandboxExecute({ code, rows });
  }

  const prevAttempts = Array.isArray(state.attempts) ? state.attempts : [];
  const attempts = [
    ...prevAttempts,
    {
      code,
      explanation: state.codeExplanation || "",
      executionResult,
    },
  ];

  return { executionResult, attempts };
}

module.exports = { executeCode };
