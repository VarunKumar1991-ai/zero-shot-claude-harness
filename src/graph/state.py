"""Agent state for the UP Police Data Analyst Agent's LangGraph query pipeline.

See spec/agent.md -> "Agent State" (binding). Every node reads/writes a subset
of these fields; the full shape travels through every node so LangGraph can
merge partial updates.
"""
from typing import TypedDict


class AgentState(TypedDict, total=False):
    # Identity
    query_run_id: str
    user_id: str
    dataset_id: str

    # Input
    question: str
    conversation_history: list[dict]  # [{"question": str, "answer": str}, ...] last N turns

    # Context (populated by load_context)
    schema_context: dict  # {columns: [...], row_count, date_range}
    sample_rows: list[dict]  # <=5 rows, free-text/narrative columns redacted
    annotations: dict[str, str]  # column_name -> business-rule note (empty {} until Phase 2)

    # Classification
    complexity: str  # "simple" | "complex"
    needs_clarification: bool
    clarifying_question: str | None

    # Planning (complex questions only)
    plan: list[str] | None

    # Code generation / execution loop
    current_code: str | None
    attempts: list[dict]  # [{attempt_number, code, stdout, result, error, duration_ms}]
    retry_count: int
    max_retries: int
    execution_result: dict | None
    execution_error: str | None

    # Output
    final_answer: str | None
    key_numbers: dict | None
    assumptions: list[str]
    followups: list[str]  # [] in Phase 1 (stub); real from Phase 3

    # Usage
    prompt_tokens: int
    completion_tokens: int
    estimated_cost_usd: float

    # Control
    current_node: str  # written after every node for progress polling
    status: str  # "pending" | "needs_clarification" | "completed" | "failed"
    error: str | None  # set by any node on fatal failure
