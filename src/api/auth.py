from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from api._common import ok, api_error
from auth.dependency import SESSION_COOKIE_NAME, get_current_user
from auth.password import verify_password
from auth.session import create_session, revoke_session
from config.settings import get_settings
from db.models import AuthEvent, SessionRow, User
from db.session import get_session
from domain.auth import LoginRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, session_id: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=settings.session_ttl_hours * 3600,
    )


@router.post("/login")
def login(req: LoginRequest, response: Response, session: Session = Depends(get_session)) -> dict:
    username = (req.username or "").strip()
    password = req.password or ""
    if not username or not password:
        raise api_error("INVALID_REQUEST", "username and password are required", 400)

    user = session.execute(select(User).where(User.username == username)).scalar_one_or_none()

    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        session.add(
            AuthEvent(
                user_id=user.id if user is not None else None,
                username_attempted=username,
                event_type="login_failure",
            )
        )
        # commit explicitly — the get_session dependency rolls back on any
        # exception (including this 401), and the failure record must survive
        # regardless of the resulting error response.
        session.commit()
        raise api_error("INVALID_CREDENTIALS", "Invalid username or password", 401)

    new_session = create_session(session, user.id)
    user.last_login_at = datetime.now(timezone.utc)
    session.add(
        AuthEvent(
            user_id=user.id,
            username_attempted=username,
            event_type="login_success",
        )
    )
    session.flush()

    _set_session_cookie(response, new_session.id)

    return ok(
        UserOut(
            user_id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
        ).model_dump()
    )


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        revoke_session(session, session_id)

    session.add(
        AuthEvent(
            user_id=user.id,
            username_attempted=user.username,
            event_type="logout",
        )
    )
    session.flush()

    response.delete_cookie(key=SESSION_COOKIE_NAME)
    return ok({"ok": True})


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return ok(
        UserOut(
            user_id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
        ).model_dump()
    )
