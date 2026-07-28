import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from api._common import ok, api_error
from auth.dependency import get_current_user
from db.models import AuthEvent, Dataset, QueryAttempt, QueryRun, User
from db.session import get_session

router = APIRouter(tags=["audit"])


def _parse_iso_date(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.get("/audit")
def list_audit(
    user_id: str | None = None,
    dataset_id: str | None = None,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
    _current_user: User = Depends(get_current_user),
) -> dict:
    from_dt = _parse_iso_date(from_)
    to_dt = _parse_iso_date(to)

    items: list[dict] = []

    # --- AuthEvent (login_success | login_failure | logout) ---
    auth_stmt = select(AuthEvent)
    if user_id:
        auth_stmt = auth_stmt.where(AuthEvent.user_id == user_id)
    for event in session.execute(auth_stmt).scalars():
        ts = _ensure_aware(event.created_at)
        if from_dt and ts < from_dt:
            continue
        if to_dt and ts > to_dt:
            continue
        display_user = event.username_attempted
        if event.user_id:
            user_row = session.get(User, event.user_id)
            if user_row is not None:
                display_user = user_row.full_name
        items.append(
            {
                "type": event.event_type,
                "user": display_user,
                "timestamp": ts.isoformat(),
                "detail": event.event_type.replace("_", " "),
            }
        )

    # --- Dataset uploads ---
    ds_stmt = select(Dataset)
    if user_id:
        ds_stmt = ds_stmt.where(Dataset.uploaded_by_user_id == user_id)
    if dataset_id:
        ds_stmt = ds_stmt.where(Dataset.id == dataset_id)
    for dataset in session.execute(ds_stmt).scalars():
        ts = _ensure_aware(dataset.created_at)
        if from_dt and ts < from_dt:
            continue
        if to_dt and ts > to_dt:
            continue
        uploader = session.get(User, dataset.uploaded_by_user_id)
        detail = f"{dataset.row_count:,} rows" if dataset.row_count is not None else dataset.status
        items.append(
            {
                "type": "upload",
                "user": uploader.full_name if uploader is not None else "unknown",
                "dataset": dataset.name,
                "timestamp": ts.isoformat(),
                "detail": detail,
            }
        )

    # --- QueryRun (queries asked) ---
    q_stmt = select(QueryRun)
    if user_id:
        q_stmt = q_stmt.where(QueryRun.user_id == user_id)
    if dataset_id:
        q_stmt = q_stmt.where(QueryRun.dataset_id == dataset_id)
    for query_run in session.execute(q_stmt).scalars():
        ts = _ensure_aware(query_run.started_at)
        if from_dt and ts < from_dt:
            continue
        if to_dt and ts > to_dt:
            continue
        user_row = session.get(User, query_run.user_id)
        dataset_row = session.get(Dataset, query_run.dataset_id)
        items.append(
            {
                "type": "query",
                "user": user_row.full_name if user_row is not None else "unknown",
                "dataset": dataset_row.name if dataset_row is not None else "unknown",
                "timestamp": ts.isoformat(),
                "detail": query_run.question,
                "status": query_run.status,
                "query_run_id": query_run.id,
            }
        )

    items.sort(key=lambda item: item["timestamp"], reverse=True)

    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start : start + page_size]

    return ok({"items": page_items, "page": page, "page_size": page_size, "total": total})


@router.get("/audit/{query_run_id}")
def get_audit_detail(
    query_run_id: str,
    session: Session = Depends(get_session),
    _current_user: User = Depends(get_current_user),
) -> dict:
    query_run = session.get(QueryRun, query_run_id)
    if query_run is None:
        raise api_error("NOT_FOUND", f"Query run {query_run_id} not found", 404)

    user_row = session.get(User, query_run.user_id)
    dataset_row = session.get(Dataset, query_run.dataset_id)

    attempts = (
        session.execute(
            select(QueryAttempt)
            .where(QueryAttempt.query_run_id == query_run.id)
            .order_by(QueryAttempt.attempt_number)
        )
        .scalars()
        .all()
    )

    return ok(
        {
            "query_run_id": query_run.id,
            "status": query_run.status,
            "question": query_run.question,
            "final_answer": query_run.final_answer,
            "key_numbers": json.loads(query_run.key_numbers_json) if query_run.key_numbers_json else None,
            "assumptions": json.loads(query_run.assumptions_json) if query_run.assumptions_json else [],
            "complexity": query_run.complexity,
            "plan": json.loads(query_run.plan_json) if query_run.plan_json else None,
            "clarifying_question": query_run.clarifying_question,
            "error": query_run.error_message,
            "attempts": [
                {
                    "attempt_number": attempt.attempt_number,
                    "generated_code": attempt.generated_code,
                    "execution_result": (
                        json.loads(attempt.execution_result_json)
                        if attempt.execution_result_json
                        else None
                    ),
                    "execution_error": attempt.execution_error,
                    "duration_ms": attempt.duration_ms,
                }
                for attempt in attempts
            ],
            "followups": json.loads(query_run.followups_json) if query_run.followups_json else [],
            "prompt_tokens": query_run.prompt_tokens,
            "completion_tokens": query_run.completion_tokens,
            "estimated_cost_usd": float(query_run.estimated_cost_usd),
            "started_at": _ensure_aware(query_run.started_at).isoformat(),
            "completed_at": (
                _ensure_aware(query_run.completed_at).isoformat()
                if query_run.completed_at is not None
                else None
            ),
            "user": {
                "user_id": user_row.id if user_row is not None else query_run.user_id,
                "username": user_row.username if user_row is not None else "unknown",
                "full_name": user_row.full_name if user_row is not None else "unknown",
            },
            "dataset": {
                "dataset_id": dataset_row.id if dataset_row is not None else query_run.dataset_id,
                "name": dataset_row.name if dataset_row is not None else "unknown",
            },
        }
    )
