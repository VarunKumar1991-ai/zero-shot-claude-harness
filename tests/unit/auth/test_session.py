from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from auth.session import create_session, get_session, revoke_session
from db.models import User


def _make_user(db: Session) -> str:
    user = User(
        username="officer.test",
        password_hash="irrelevant-for-this-test",
        full_name="Test Officer",
        role="officer",
    )
    db.add(user)
    db.flush()
    db.commit()
    return user.id


def test_create_and_get_session_valid(_isolated_db):
    with Session(_isolated_db) as db:
        user_id = _make_user(db)
        session_row = create_session(db, user_id)
        db.commit()
        session_id = session_row.id

    with Session(_isolated_db) as db:
        fetched = get_session(db, session_id)
        assert fetched is not None
        assert fetched.user_id == user_id


def test_get_session_returns_none_for_unknown_id(_isolated_db):
    with Session(_isolated_db) as db:
        assert get_session(db, "does-not-exist") is None


def test_get_session_returns_none_when_expired(_isolated_db, monkeypatch):
    with Session(_isolated_db) as db:
        user_id = _make_user(db)
        session_row = create_session(db, user_id)
        # force the session into the past so it reads as expired
        session_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        session_id = session_row.id

    with Session(_isolated_db) as db:
        assert get_session(db, session_id) is None


def test_revoke_session_invalidates_it(_isolated_db):
    with Session(_isolated_db) as db:
        user_id = _make_user(db)
        session_row = create_session(db, user_id)
        db.commit()
        session_id = session_row.id

    with Session(_isolated_db) as db:
        assert get_session(db, session_id) is not None

    with Session(_isolated_db) as db:
        revoke_session(db, session_id)
        db.commit()

    with Session(_isolated_db) as db:
        assert get_session(db, session_id) is None


def test_revoke_unknown_session_is_a_noop(_isolated_db):
    with Session(_isolated_db) as db:
        revoke_session(db, "does-not-exist")
        db.commit()
