"""Pydantic request models for the query agent API (spec/api.md)."""
from pydantic import BaseModel


class QueryCreateRequest(BaseModel):
    question: str


class QueryAttemptResponse(BaseModel):
    attempt_number: int
    generated_code: str
    execution_result: dict | list | None = None
    execution_error: str | None = None
    duration_ms: int


class ConversationTurn(BaseModel):
    query_run_id: str
    question: str
    final_answer: str | None = None
    status: str
    started_at: str
