"""LangGraph nodes for the UP Police Data Analyst Agent's query pipeline.

See spec/agent.md -> "Nodes / Steps" (binding). Per the "Conditional edges"
table, only `load_context` and `classify_and_assess` can route to
`handle_error` -- every node past classification has no fatal edge in the
topology, so LLM/tool failures there degrade gracefully (empty plan, a
code-generation failure becomes a sandboxed error the retry loop can act on,
answer synthesis falls back to a deterministic summary) rather than crashing
the run.
"""
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select

from config.settings import get_settings
from data_sources.registry import get_data_source
from db.models import Dataset, QueryAttempt, QueryRun
from db.session import create_db_session
from graph.state import AgentState
from llm.client import LLMClient
from observability.events import get_logger
from sandbox.executor import run_sandboxed

log = get_logger("graph.nodes")

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"
_COST_PER_1K_TOKENS = 0.001  # rough blended estimate; the LLM client does not expose real usage metadata


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


def _call_with_backoff(prompt: str, *, system: str, model: str | None, max_attempts: int = 3) -> str:
    """Wraps every Gemini call with 2 retries (exponential backoff, starting at
    1s) for transient errors, per spec/agent.md -> "Fallback behaviour"."""
    client = LLMClient()
    delay = 1.0
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return client.call_model(prompt, system=system, model=model)
        except Exception as exc:  # noqa: BLE001 - genuinely any provider failure is transient here
            last_exc = exc
            if attempt < max_attempts - 1:
                time.sleep(delay)
                delay *= 2
    assert last_exc is not None
    raise last_exc


def _usage_delta(prompt_text: str, completion_text: str) -> tuple[int, int, float]:
    prompt_tokens = max(1, len(prompt_text) // 4)
    completion_tokens = max(1, len(completion_text) // 4)
    cost = (prompt_tokens + completion_tokens) / 1000 * _COST_PER_1K_TOKENS
    return prompt_tokens, completion_tokens, round(cost, 6)


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    stripped = text.strip()
    match = re.search(r"\{.*\}", stripped, re.DOTALL)
    candidate = match.group(0) if match else stripped
    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _extract_code(raw: str) -> str:
    text = raw.strip()
    match = re.search(r"```(?:python)?\s*(.*?)```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    if "def analyze(" not in text:
        return (
            "def analyze(df):\n"
            "    raise RuntimeError('Model did not return a valid analyze(df) function')\n"
        )
    return text


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def _looks_narrative(sample_df, column_name: str) -> bool:
    if column_name not in sample_df.columns:
        return False
    values = sample_df[column_name].dropna().astype(str)
    if values.empty:
        return False
    return bool(values.str.len().mean() > 40)


def _format_history(history: list[dict] | None) -> str:
    if not history:
        return "(no prior questions in this conversation)"
    lines = [f"Q: {h['question']}\nA: {h.get('answer') or '(no answer)'}" for h in history]
    return "\n\n".join(lines)


def _get_dataset_storage_path(dataset_id: str) -> str | None:
    with create_db_session() as db:
        dataset = db.get(Dataset, dataset_id)
        return dataset.storage_path if dataset is not None else None


# ---------------------------------------------------------------------------
# load_context
# ---------------------------------------------------------------------------


def load_context(state: AgentState) -> AgentState:
    dataset_id = state["dataset_id"]
    user_id = state.get("user_id")

    try:
        with create_db_session() as db:
            dataset = db.get(Dataset, dataset_id)
            if dataset is None:
                return {**state, "error": f"Dataset {dataset_id} not found", "current_node": "load_context"}
            storage_path = dataset.storage_path

        data_source = get_data_source()
        profile = data_source.profile(storage_path)
        sample_df = data_source.get_dataframe(storage_path).head(5)
    except Exception as exc:
        log.error("load_context.dataset_read_failed", dataset_id=dataset_id, error=str(exc))
        return {**state, "error": "The dataset could not be read for analysis.", "current_node": "load_context"}

    narrative_columns = {
        col.name for col in profile.columns
        if col.dtype == "string" and _looks_narrative(sample_df, col.name)
    }

    sample_rows: list[dict] = []
    for record in sample_df.to_dict(orient="records"):
        sample_rows.append({
            key: "[redacted]" if key in narrative_columns else _json_safe(value)
            for key, value in record.items()
        })

    columns_context = []
    for col in profile.columns:
        entry: dict[str, Any] = {
            "name": col.name, "dtype": col.dtype, "null_count": col.null_count,
            "distinct_count": col.distinct_count, "min": col.min, "max": col.max,
        }
        if col.distinct_count and col.distinct_count <= 20:
            try:
                entry["distinct_values"] = data_source.distinct_values(storage_path, col.name, limit=20)
            except Exception:
                entry["distinct_values"] = []
        columns_context.append(entry)

    schema_context = {
        "columns": columns_context,
        "row_count": profile.row_count,
        "date_range": profile.date_range.model_dump() if profile.date_range else None,
    }

    conversation_history: list[dict] = []
    try:
        settings = get_settings()
        with create_db_session() as db:
            past_runs = db.execute(
                select(QueryRun)
                .where(
                    QueryRun.dataset_id == dataset_id,
                    QueryRun.user_id == user_id,
                    QueryRun.id != state.get("query_run_id"),
                    QueryRun.status == "completed",
                )
                .order_by(QueryRun.started_at.desc())
                .limit(settings.conversation_history_turns)
            ).scalars().all()
        for run in reversed(past_runs):
            conversation_history.append({"question": run.question, "answer": run.final_answer or ""})
    except Exception as exc:
        log.warning("load_context.history_read_failed", dataset_id=dataset_id, error=str(exc))

    return {
        **state,
        "schema_context": schema_context,
        "sample_rows": sample_rows,
        "annotations": {},
        "conversation_history": conversation_history,
        "current_node": "load_context",
    }


# ---------------------------------------------------------------------------
# classify_and_assess
# ---------------------------------------------------------------------------


def _build_classify_prompt(state: AgentState) -> str:
    return (
        f"Question: {state.get('question')}\n\n"
        f"Dataset schema:\n{json.dumps(state.get('schema_context') or {}, indent=2, default=str)}\n\n"
        f"Conversation history:\n{_format_history(state.get('conversation_history'))}"
    )


def classify_and_assess(state: AgentState) -> AgentState:
    settings = get_settings()
    system = _load_prompt("classify.md")
    user_prompt = _build_classify_prompt(state)

    parsed: dict | None = None
    error_detail: str | None = None
    prompt_tokens = 0
    completion_tokens = 0
    cost = 0.0

    for _ in range(2):  # malformed JSON is retried once, then falls back to a safe default
        try:
            raw = _call_with_backoff(user_prompt, system=system, model=settings.llm_fast_model)
        except Exception as exc:
            error_detail = str(exc)
            break
        pt, ct, c = _usage_delta(user_prompt, raw)
        prompt_tokens += pt
        completion_tokens += ct
        cost += c
        parsed = _extract_json(raw)
        if parsed is not None:
            break

    if parsed is None and error_detail is not None:
        log.error("classify_and_assess.llm_failed", error=error_detail)
        return {
            **state,
            "error": "The analysis service is temporarily unavailable — please try again.",
            "current_node": "classify_and_assess",
        }

    if parsed is None:
        complexity, needs_clarification, clarifying_question = "complex", False, None
    else:
        complexity = parsed.get("complexity") or "complex"
        confidence = parsed.get("confidence", 1.0)
        ambiguous_terms = parsed.get("ambiguous_terms") or []
        needs_clarification = bool(
            confidence is not None and confidence < 0.55 and ambiguous_terms
        )
        clarifying_question = parsed.get("clarifying_question") if needs_clarification else None

    return {
        **state,
        "complexity": complexity,
        "needs_clarification": needs_clarification,
        "clarifying_question": clarifying_question,
        "current_node": "classify_and_assess",
        "prompt_tokens": state.get("prompt_tokens", 0) + prompt_tokens,
        "completion_tokens": state.get("completion_tokens", 0) + completion_tokens,
        "estimated_cost_usd": round(state.get("estimated_cost_usd", 0.0) + cost, 6),
    }


# ---------------------------------------------------------------------------
# plan_analysis
# ---------------------------------------------------------------------------


def _build_plan_prompt(state: AgentState) -> str:
    return (
        f"Question: {state.get('question')}\n\n"
        f"Dataset schema:\n{json.dumps(state.get('schema_context') or {}, indent=2, default=str)}\n\n"
        f"Conversation history:\n{_format_history(state.get('conversation_history'))}"
    )


def plan_analysis(state: AgentState) -> AgentState:
    settings = get_settings()
    system = _load_prompt("plan.md")
    user_prompt = _build_plan_prompt(state)

    try:
        raw = _call_with_backoff(user_prompt, system=system, model=settings.llm_model or None)
    except Exception as exc:
        log.warning("plan_analysis.llm_failed", error=str(exc))
        return {**state, "plan": None, "current_node": "plan_analysis"}

    pt, ct, c = _usage_delta(user_prompt, raw)
    steps = [line.strip("-•* \t") for line in raw.splitlines() if line.strip()]
    steps = [s for s in steps if s][:5]

    return {
        **state,
        "plan": steps or None,
        "current_node": "plan_analysis",
        "prompt_tokens": state.get("prompt_tokens", 0) + pt,
        "completion_tokens": state.get("completion_tokens", 0) + ct,
        "estimated_cost_usd": round(state.get("estimated_cost_usd", 0.0) + c, 6),
    }


# ---------------------------------------------------------------------------
# generate_code
# ---------------------------------------------------------------------------


def _build_generate_code_prompt(state: AgentState) -> str:
    parts = [
        f"Question: {state.get('question')}",
        f"Dataset schema:\n{json.dumps(state.get('schema_context') or {}, indent=2, default=str)}",
        f"Sample rows (redacted where narrative):\n{json.dumps(state.get('sample_rows') or [], indent=2, default=str)}",
        f"Annotations: {json.dumps(state.get('annotations') or {}, default=str)}",
    ]
    if state.get("plan"):
        parts.append("Plan:\n" + "\n".join(f"- {step}" for step in state["plan"]))
    attempts = state.get("attempts") or []
    if attempts and attempts[-1].get("error"):
        last = attempts[-1]
        parts.append(
            "The previous attempt FAILED. Try a genuinely different approach, not a minor edit.\n"
            f"Previous code:\n{last.get('code')}\n"
            f"Previous error:\n{last.get('error')}"
        )
    parts.append(f"Conversation history:\n{_format_history(state.get('conversation_history'))}")
    return "\n\n".join(parts)


def generate_code(state: AgentState) -> AgentState:
    settings = get_settings()
    system = _load_prompt("generate_code.md")
    user_prompt = _build_generate_code_prompt(state)

    attempts = list(state.get("attempts") or [])
    attempt_number = len(attempts) + 1

    prompt_tokens_delta = 0
    completion_tokens_delta = 0
    cost_delta = 0.0

    try:
        raw = _call_with_backoff(user_prompt, system=system, model=settings.llm_model or None)
        prompt_tokens_delta, completion_tokens_delta, cost_delta = _usage_delta(user_prompt, raw)
        code = _extract_code(raw)
    except Exception as exc:
        log.warning("generate_code.llm_failed", error=str(exc))
        code = (
            "def analyze(df):\n"
            f"    raise RuntimeError({str(exc)!r})\n"
        )

    attempts.append({
        "attempt_number": attempt_number,
        "code": code,
        "stdout": None,
        "result": None,
        "error": None,
        "duration_ms": None,
    })

    return {
        **state,
        "current_code": code,
        "attempts": attempts,
        "current_node": "generate_code",
        "prompt_tokens": state.get("prompt_tokens", 0) + prompt_tokens_delta,
        "completion_tokens": state.get("completion_tokens", 0) + completion_tokens_delta,
        "estimated_cost_usd": round(state.get("estimated_cost_usd", 0.0) + cost_delta, 6),
    }


# ---------------------------------------------------------------------------
# execute_code
# ---------------------------------------------------------------------------


def execute_code(state: AgentState) -> AgentState:
    dataset_id = state["dataset_id"]
    code = state.get("current_code") or ""
    attempts = list(state.get("attempts") or [])

    try:
        storage_path = _get_dataset_storage_path(dataset_id)
        if storage_path is None:
            raise RuntimeError("Dataset not found for execution")
        data_source = get_data_source()
        df = data_source.get_dataframe(storage_path)
        settings = get_settings()
        result, stdout, error, duration_ms = run_sandboxed(code, df, settings.sandbox_timeout_seconds)
    except Exception as exc:
        result, stdout, error, duration_ms = None, "", f"{type(exc).__name__}: {exc}", 0

    if attempts:
        attempts[-1] = {**attempts[-1], "stdout": stdout, "result": result, "error": error, "duration_ms": duration_ms}

    return {
        **state,
        "execution_result": result,
        "execution_error": error,
        "attempts": attempts,
        "current_node": "execute_code",
    }


# ---------------------------------------------------------------------------
# inspect_result
# ---------------------------------------------------------------------------


def _execution_unsatisfactory(state: AgentState) -> bool:
    if state.get("execution_error"):
        return True
    result = state.get("execution_result")
    if result is None:
        return True
    if isinstance(result, dict):
        values = [v for k, v in result.items() if k != "truncated"]
        if not values or all(v is None for v in values):
            return True
    return False


def inspect_result(state: AgentState) -> AgentState:
    unsatisfactory = _execution_unsatisfactory(state)
    retry_count = state.get("retry_count", 0)
    max_retries = state.get("max_retries", 3)
    needs_retry = unsatisfactory and retry_count < max_retries

    updates: dict[str, Any] = {"current_node": "inspect_result", "_needs_retry": needs_retry}
    if needs_retry:
        updates["retry_count"] = retry_count + 1
    elif unsatisfactory:
        assumptions = list(state.get("assumptions") or [])
        assumptions.append(
            f"Best guess after {retry_count} attempt(s); the result may be incomplete or the "
            "question could not be fully resolved against this dataset."
        )
        updates["assumptions"] = assumptions

    return {**state, **updates}


# ---------------------------------------------------------------------------
# synthesize_answer
# ---------------------------------------------------------------------------


def _build_synthesize_prompt(state: AgentState) -> str:
    parts = [
        f"Question: {state.get('question')}",
        f"Computed result (already aggregated, never raw rows):\n{json.dumps(state.get('execution_result'), indent=2, default=str)}",
    ]
    if state.get("plan"):
        parts.append("Plan followed:\n" + "\n".join(f"- {step}" for step in state["plan"]))
    if state.get("assumptions"):
        parts.append("Assumptions flagged so far:\n" + "\n".join(f"- {a}" for a in state["assumptions"]))
    parts.append(f"Conversation history:\n{_format_history(state.get('conversation_history'))}")
    return "\n\n".join(parts)


def synthesize_answer(state: AgentState) -> AgentState:
    settings = get_settings()
    system = _load_prompt("synthesize_answer.md")
    user_prompt = _build_synthesize_prompt(state)

    execution_result = state.get("execution_result")
    assumptions = list(state.get("assumptions") or [])

    try:
        raw = _call_with_backoff(user_prompt, system=system, model=settings.llm_model or None)
        pt, ct, c = _usage_delta(user_prompt, raw)
        final_answer = raw.strip()
    except Exception as exc:
        log.warning("synthesize_answer.llm_failed", error=str(exc))
        pt, ct, c = 0, 0, 0.0
        final_answer = (
            f"The analysis completed with result: {execution_result}"
            if execution_result is not None
            else "The analysis could not produce a result."
        )
        assumptions.append("Answer synthesis failed; showing the raw computed result instead of a written summary.")

    key_numbers = execution_result if isinstance(execution_result, dict) else None

    return {
        **state,
        "final_answer": final_answer,
        "key_numbers": key_numbers,
        "assumptions": assumptions,
        "current_node": "synthesize_answer",
        "prompt_tokens": state.get("prompt_tokens", 0) + pt,
        "completion_tokens": state.get("completion_tokens", 0) + ct,
        "estimated_cost_usd": round(state.get("estimated_cost_usd", 0.0) + c, 6),
    }


# ---------------------------------------------------------------------------
# suggest_followups (Phase 1 stub — no LLM call, per spec/agent.md)
# ---------------------------------------------------------------------------


def suggest_followups(state: AgentState) -> AgentState:
    return {**state, "followups": [], "current_node": "suggest_followups"}


# ---------------------------------------------------------------------------
# request_clarification / handle_error / finalize
# ---------------------------------------------------------------------------


def request_clarification(state: AgentState) -> AgentState:
    return {**state, "status": "needs_clarification", "current_node": "request_clarification"}


def handle_error(state: AgentState) -> AgentState:
    log.error(
        "handle_error",
        query_run_id=state.get("query_run_id"),
        user_id=state.get("user_id"),
        dataset_id=state.get("dataset_id"),
        error=state.get("error"),
    )
    return {**state, "status": "failed", "current_node": "handle_error"}


def finalize(state: AgentState) -> AgentState:
    """The audit-trail write path (spec/capabilities/server-side-audit-trail.md).
    Runs on every path — success, clarification, and failure."""
    status = state.get("status")
    if status in (None, "", "pending"):
        # "pending" is the initial placeholder set by the API layer; only
        # request_clarification/handle_error explicitly set a terminal status
        # on the way here, so anything still "pending" at finalize means the
        # happy path completed successfully.
        status = "completed"
    query_run_id = state.get("query_run_id")

    try:
        with create_db_session() as db:
            run = db.get(QueryRun, query_run_id)
            if run is None:
                run = QueryRun(
                    id=query_run_id,
                    dataset_id=state.get("dataset_id"),
                    user_id=state.get("user_id"),
                    question=state.get("question", ""),
                )
                db.add(run)

            run.status = status
            run.current_node = "finalize"
            run.complexity = state.get("complexity")
            run.plan_json = json.dumps(state["plan"]) if state.get("plan") else None
            run.clarifying_question = state.get("clarifying_question")
            run.final_answer = state.get("final_answer")
            run.key_numbers_json = json.dumps(state["key_numbers"]) if state.get("key_numbers") is not None else None
            run.assumptions_json = json.dumps(state.get("assumptions") or [])
            run.followups_json = json.dumps(state.get("followups") or [])
            run.error_message = state.get("error")
            run.prompt_tokens = state.get("prompt_tokens", 0)
            run.completion_tokens = state.get("completion_tokens", 0)
            run.estimated_cost_usd = state.get("estimated_cost_usd", 0.0)
            run.completed_at = _now()

            for attempt in state.get("attempts") or []:
                db.add(QueryAttempt(
                    query_run_id=query_run_id,
                    attempt_number=attempt["attempt_number"],
                    generated_code=attempt.get("code") or "",
                    execution_stdout=attempt.get("stdout"),
                    execution_result_json=json.dumps(attempt["result"]) if attempt.get("result") is not None else None,
                    execution_error=attempt.get("error"),
                    duration_ms=attempt.get("duration_ms") or 0,
                ))
    except Exception as exc:
        log.error("finalize.persist_failed", query_run_id=query_run_id, error=str(exc))

    return {**state, "status": status, "current_node": "finalize"}
