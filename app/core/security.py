import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import settings


def hash_token(token: str) -> str:
    """
    Computes SHA-256 hash of an opaque token for safe database storage.
    Raw tokens are never stored or logged.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_opaque_token(prefix: str = "wbt") -> str:
    """
    Generates a cryptographically strong opaque token (e.g., wbt_...).
    """
    random_bytes = secrets.token_urlsafe(32)
    return f"{prefix}_{random_bytes}"


def create_session_token() -> str:
    """
    Creates an opaque session token.
    Format: raw opaque token. The SHA-256 hash will be stored in database.
    """
    return generate_opaque_token("wbs")


def create_invite_token() -> tuple[str, str, datetime]:
    """
    Generates a party invitation token.
    Returns:
        (raw_token, token_hash, expires_at)
    Raw token is returned to the creator once and never stored in database.
    """
    raw_token = generate_opaque_token("wpi")
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.party_invite_expire_hours)
    return raw_token, token_hash, expires_at
