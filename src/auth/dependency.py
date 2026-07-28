"""FastAPI dependency for session-cookie auth.

Exports `get_current_user`, imported by every protected route across slices
(`dataset-upload-profiling`, `query-agent-graph`, and this slice's own
`api/auth.py` / `api/audit.py`):

    from auth.dependency import get_current_user

    @router.get("/something")
    def handler(user: User = Depends(get_current_user)) -> dict:
        ...

Reads the `sid` httpOnly cookie, validates the session (unexpired, unrevoked),
loads the owning `User`, and raises `401 UNAUTHENTICATED` (via `api_error`) if
the cookie is missing or the session is invalid/expired/revoked.
"""
from fastapi import Depends, Request
from sqlalchemy.orm import Session as DbSession

from api._common import api_error
from auth.session import get_session
from db.models import User
from db.session import get_session as get_session_db

SESSION_COOKIE_NAME = "sid"


def get_current_user(
    request: Request, db: DbSession = Depends(get_session_db)
) -> User:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise api_error("UNAUTHENTICATED", "No active session", 401)

    session = get_session(db, session_id)
    if session is None:
        raise api_error("UNAUTHENTICATED", "Session is invalid, expired, or revoked", 401)

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise api_error("UNAUTHENTICATED", "User not found or inactive", 401)

    return user
