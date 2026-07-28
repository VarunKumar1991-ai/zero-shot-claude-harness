"""Server-side session issuance/validation/revocation.

Sessions are rows in the `sessions` table (see `db.models.SessionRow`) — chosen
over stateless JWTs for auditability/revocability in a government context
(see spec/architecture.md). The session `id` doubles as the `sid` cookie value.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from config.settings import get_settings
from db.models import SessionRow


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_session(db: DbSession, user_id: str) -> SessionRow:
    """Issue a new session for `user_id`, TTL from `settings.session_ttl_hours`."""
    settings = get_settings()
    now = _now()
    session = SessionRow(
        user_id=user_id,
        created_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    db.flush()
    return session


def get_session(db: DbSession, session_id: str) -> SessionRow | None:
    """Return the session row if it exists, is unexpired, and unrevoked — else None."""
    if not session_id:
        return None
    session = db.get(SessionRow, session_id)
    if session is None:
        return None
    if session.revoked_at is not None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= _now():
        return None
    return session


def revoke_session(db: DbSession, session_id: str) -> None:
    """Revoke a session (idempotent — no-op if missing or already revoked)."""
    session = db.get(SessionRow, session_id)
    if session is not None and session.revoked_at is None:
        session.revoked_at = _now()
        db.flush()
