"""Provision a User account for local username/password auth.

Phase 1 has no self-service registration (see spec/data.md → User). Accounts
are provisioned via this CLI.

Usage:
    uv run python -m src.auth.seed <username> <full_name> <role> [station] [--password PLAINTEXT]

If `--password` is omitted you will be prompted (input hidden via `getpass`).

`role` must be one of: officer | hq_analyst | admin.

Seeded demo account for local testing / the qa-auditor gate (created below by
`seed_demo_account()`, also invocable directly: `uv run python -m src.auth.seed --demo`):

    username:  demo.officer
    password:  Demo@Pass123
    full_name: Demo Officer
    role:      officer
"""
import argparse
import getpass
import sys

from sqlalchemy import select

from auth.password import hash_password
from db.models import User
from db.session import create_db_session

VALID_ROLES = {"officer", "hq_analyst", "admin"}

DEMO_USERNAME = "demo.officer"
DEMO_PASSWORD = "Demo@Pass123"
DEMO_FULL_NAME = "Demo Officer"
DEMO_ROLE = "officer"


def create_user(
    username: str, full_name: str, role: str, password: str, station: str | None = None
) -> str:
    if role not in VALID_ROLES:
        raise ValueError(f"role must be one of {sorted(VALID_ROLES)}, got {role!r}")
    if not password:
        raise ValueError("password must not be empty")

    with create_db_session() as session:
        existing = session.execute(
            select(User).where(User.username == username)
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError(f"username {username!r} already exists")

        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name=full_name,
            role=role,
            station=station,
        )
        session.add(user)
        session.flush()
        return user.id


def seed_demo_account() -> str | None:
    """Idempotently ensure the demo/test account exists. Returns the user id, or
    None if it already existed."""
    with create_db_session() as session:
        existing = session.execute(
            select(User).where(User.username == DEMO_USERNAME)
        ).scalar_one_or_none()
        if existing is not None:
            return None
        user = User(
            username=DEMO_USERNAME,
            password_hash=hash_password(DEMO_PASSWORD),
            full_name=DEMO_FULL_NAME,
            role=DEMO_ROLE,
        )
        session.add(user)
        session.flush()
        return user.id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username", nargs="?")
    parser.add_argument("full_name", nargs="?")
    parser.add_argument("role", nargs="?")
    parser.add_argument("station", nargs="?", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument(
        "--demo", action="store_true", help="Seed the built-in demo.officer test account"
    )
    args = parser.parse_args()

    if args.demo:
        user_id = seed_demo_account()
        if user_id is None:
            print(f"Demo account {DEMO_USERNAME!r} already exists.")
        else:
            print(f"Created demo account {DEMO_USERNAME!r} (id={user_id}).")
        return

    if not (args.username and args.full_name and args.role):
        parser.print_help()
        sys.exit(1)

    password = args.password or getpass.getpass("Password: ")
    user_id = create_user(args.username, args.full_name, args.role, password, args.station)
    print(f"Created user {args.username!r} (id={user_id}).")


if __name__ == "__main__":
    main()
