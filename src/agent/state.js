"use strict";

/**
 * LangGraph.js state channel definitions for the agent graph.
 * Mirrors spec/agent.md's `AgentState` shape exactly.
 *
 * IMPORTANT (observed langgraph@0.2.x behaviour): `default` initializers are
 * NOT eagerly merged into the object handed to the first node — a node
 * invoked with a sparse initial input can still see `undefined` for fields
 * with declared defaults. Every node in src/agent/nodes/*.js therefore reads
 * state defensively (e.g. `state.attempts || []`) rather than relying solely
 * on the declared default.
 */

const { Annotation } = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  // Identity
  runId: Annotation(),
  userId: Annotation(),
  datasetId: Annotation(),

  // Input
  question: Annotation(),
  conversationHistory: Annotation({ default: () => [] }), // Phase 2

  // Dataset context (populated by load_context)
  datasetProfile: Annotation(),
  annotations: Annotation({ default: () => [] }), // Phase 2
  sampleRows: Annotation({ default: () => [] }), // <=20 rows, LLM prompt context ONLY
  rows: Annotation({ default: () => [] }), // full parsed dataset — in-process only
  columns: Annotation({ default: () => [] }),

  // Classification / planning
  // NOTE: named `planSteps` (not `plan`, per the spec/agent.md field name)
  // because @langchain/langgraph 0.2.x forbids a state channel and a graph
  // node from sharing the same identifier, and the `plan` NODE name is the
  // one that must match spec/agent.md's graph topology exactly.
  complexity: Annotation(),
  clarifyingQuestion: Annotation({ default: () => null }),
  planSteps: Annotation({ default: () => [] }),

  // Code generation / execution loop
  generatedCode: Annotation(),
  codeExplanation: Annotation(),
  executionResult: Annotation({ default: () => null }),
  attempts: Annotation({ default: () => [] }),
  retryCount: Annotation({ default: () => 0 }),

  // Inspection
  inspectionVerdict: Annotation(),
  inspectionNote: Annotation(),

  // Output
  answer: Annotation({ default: () => null }),
  keyNumbers: Annotation({ default: () => [] }),
  assumptions: Annotation({ default: () => [] }),
  chartSpec: Annotation({ default: () => null }), // Phase 2
  followups: Annotation({ default: () => [] }), // Phase 1: always []
  tokenUsage: Annotation({ default: () => ({ promptTokens: 0, completionTokens: 0 }) }),

  // Control
  error: Annotation({ default: () => null }),
  status: Annotation({ default: () => "running" }),
});

module.exports = { AgentState };
