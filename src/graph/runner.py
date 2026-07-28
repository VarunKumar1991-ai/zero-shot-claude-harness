"""Runs the query agent graph as a FastAPI background task.

Builds the initial `AgentState` and streams the compiled graph
(`agentic_ai.stream(..., stream_mode="values")`) so `current_node` can be
persisted after every step, for real progress polling per spec/agent.md.
The `finalize` node is the actual audit-trail write path; this runner only
mirrors `current_node` in between steps and guards against an uncaught crash
leaving a run stuck at "pending" forever.
"""
import time
from datetime import datetime, timezone

from config.settings import get_settings
from db.models import QueryRun
from db.session import create_db_session
from graph.agent import agentic_ai
from graph.state import AgentState
from observability.events import get_logger

log = get_logger("graph.runner")


def run_query(query_run_id: str, user_id: str, dataset_id: str, question: str) -> None:
    settings = get_settings()
    initial_state: AgentState = {
        "query_run_id": query_run_id,
        "user_id": user_id,
        "dataset_id": dataset_id,
        "question": question,
        "conversation_history": [],
        "schema_context": {},
        "sample_rows": [],
        "annotations": {},
        "complexity": "simple",
        "needs_clarification": False,
        "clarifying_question": None,
        "plan": None,
        "current_code": None,
        "attempts": [],
        "retry_count": 0,
        "max_retries": settings.max_code_retries,
        "execution_result": None,
        "execution_error": None,
        "final_answer": None,
        "key_numbers": None,
        "assumptions": [],
        "followups": [],
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "estimated_cost_usd": 0.0,
        "current_node": None,
        "status": "pending",
        "error": None,
    }

    start = time.time()
    try:
        for step in agentic_ai.stream(initial_state, stream_mode="values"):
            current_node = step.get("current_node")
            if not current_node:
                continue
            try:
                with create_db_session() as db:
                    run = db.get(QueryRun, query_run_id)
                    if run is not None:
                        run.current_node = current_node
            except Exception:
                log.warning("runner.progress_write_failed", query_run_id=query_run_id)
        log.info(
            "runner.query_completed",
            query_run_id=query_run_id,
            duration_ms=int((time.time() - start) * 1000),
        )
    except Exception as exc:
        log.error("runner.query_crashed", query_run_id=query_run_id, error=str(exc))
        try:
            with create_db_session() as db:
                run = db.get(QueryRun, query_run_id)
                if run is not None:
                    run.status = "failed"
                    run.error_message = "The analysis service is temporarily unavailable — please try again."
                    run.completed_at = datetime.now(timezone.utc)
        except Exception:
            log.error("runner.failed_status_write_failed", query_run_id=query_run_id)
