"""Password hashing/verification for local username-password auth (bcrypt)."""
import bcrypt


def hash_password(plain: str) -> str:
    """Hash a plaintext password. Never store or log the plaintext."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash. Never raises on mismatch."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        # malformed hash — treat as a verification failure, not a crash
        return False
