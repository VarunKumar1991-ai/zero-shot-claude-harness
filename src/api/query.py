"""Query agent API routes — spec/api.md's `POST /datasets/{id}/query`,
`GET /datasets/{id}/queries/{id}`, and `GET /datasets/{id}/conversation`."""
import json

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from api._common import api_error, ok
from auth.dependency import get_current_user
from config.settings import get_settings
from db.models import Dataset, QueryAttempt, QueryRun, User
from db.session import get_session
from domain.query import QueryCreateRequest
from graph.runner import run_query

router = APIRouter(prefix="/datasets", tags=["query"])


def _ensure_aware(dt):
    from datetime import timezone
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.post("/{dataset_id}/query")
def create_query(
    dataset_id: str,
    request: QueryCreateRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict:
    question = (request.question or "").strip()
    if not question:
        raise api_error("INVALID_QUESTION", "Question must not be empty", 400)

    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise api_error("NOT_FOUND", f"Dataset {dataset_id} not found", 404)

    run = QueryRun(dataset_id=dataset_id, user_id=user.id, question=question, status="pending")
    session.add(run)
    session.flush()
    query_run_id = run.id
    session.commit()

    background_tasks.add_task(run_query, query_run_id, user.id, dataset_id, question)

    return ok({"query_run_id": query_run_id, "status": "pending"})


@router.get("/{dataset_id}/queries/{query_run_id}")
def get_query(
    dataset_id: str,
    query_run_id: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> dict:
    run = session.get(QueryRun, query_run_id)
    if run is None or run.dataset_id != dataset_id:
        raise api_error("NOT_FOUND", "Query run not found", 404)

    if run.status == "pending":
        return ok({"query_run_id": run.id, "status": "pending", "current_node": run.current_node})

    if run.status == "needs_clarification":
        return ok({
            "query_run_id": run.id,
            "status": "needs_clarification",
            "clarifying_question": run.clarifying_question,
        })

    if run.status == "failed":
        return ok({"query_run_id": run.id, "status": "failed", "error": run.error_message})

    attempts = session.execute(
        select(QueryAttempt)
        .where(QueryAttempt.query_run_id == run.id)
        .order_by(QueryAttempt.attempt_number)
    ).scalars().all()

    return ok({
        "query_run_id": run.id,
        "status": run.status,
        "question": run.question,
        "final_answer": run.final_answer,
        "key_numbers": json.loads(run.key_numbers_json) if run.key_numbers_json else None,
        "assumptions": json.loads(run.assumptions_json) if run.assumptions_json else [],
        "complexity": run.complexity,
        "plan": json.loads(run.plan_json) if run.plan_json else None,
        "attempts": [
            {
                "attempt_number": a.attempt_number,
                "generated_code": a.generated_code,
                "execution_result": json.loads(a.execution_result_json) if a.execution_result_json else None,
                "execution_error": a.execution_error,
                "duration_ms": a.duration_ms,
            }
            for a in attempts
        ],
        "followups": json.loads(run.followups_json) if run.followups_json else [],
        "prompt_tokens": run.prompt_tokens,
        "completion_tokens": run.completion_tokens,
        "estimated_cost_usd": float(run.estimated_cost_usd),
        "started_at": _ensure_aware(run.started_at).isoformat(),
        "completed_at": _ensure_aware(run.completed_at).isoformat() if run.completed_at else None,
    })


@router.get("/{dataset_id}/conversation")
def get_conversation(
    dataset_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    runs = session.execute(
        select(QueryRun)
        .where(QueryRun.dataset_id == dataset_id, QueryRun.user_id == user.id)
        .order_by(QueryRun.started_at.desc())
        .limit(settings.conversation_history_turns)
    ).scalars().all()

    return ok([
        {
            "query_run_id": r.id,
            "question": r.question,
            "final_answer": r.final_answer,
            "status": r.status,
            "started_at": _ensure_aware(r.started_at).isoformat(),
        }
        for r in reversed(runs)
    ])
