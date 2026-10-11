import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import hash_token
from app.db.session import get_session
from app.models.session import Session
from app.models.user import User

logger = logging.getLogger(__name__)


async def get_current_user_optional(
    authorization: str | None = Header(default=None, alias="Authorization"),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """
    Extracts Bearer token from Authorization header and verifies active session in database.
    Returns User if valid session exists, None otherwise.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None

    raw_token = authorization.removeprefix("Bearer ").strip()
    if not raw_token:
        return None

    token_hash = hash_token(raw_token)
    now = datetime.now(timezone.utc)

    stmt = (
        select(Session)
        .options(selectinload(Session.user).selectinload(User.profile))
        .where(
            Session.token_hash == token_hash,
            Session.is_revoked.is_(False),
            Session.expires_at > now,
        )
    )
    result = await session.execute(stmt)
    db_session_obj = result.scalars().first()

    if not db_session_obj:
        return None

    return db_session_obj.user


async def get_current_session(
    authorization: str | None = Header(default=None, alias="Authorization"),
    session: AsyncSession = Depends(get_session),
) -> Session:
    """
    Extracts Bearer token and returns active Session model instance.
    Raises 401 if missing, expired, or revoked.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer session token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_token = authorization.removeprefix("Bearer ").strip()
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Bearer token is empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_hash = hash_token(raw_token)
    now = datetime.now(timezone.utc)

    stmt = (
        select(Session)
        .options(selectinload(Session.user).selectinload(User.profile))
        .where(
            Session.token_hash == token_hash,
            Session.is_revoked.is_(False),
            Session.expires_at > now,
        )
    )
    result = await session.execute(stmt)
    db_session_obj = result.scalars().first()

    if not db_session_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session is invalid, expired, or revoked. Please authenticate again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return db_session_obj


async def get_current_user(
    current_session: Session = Depends(get_current_session),
) -> User:
    """
    Enforces authentication requirement on protected endpoints.
    Never authorizes operations using caller-supplied user UUID alone.
    """
    return current_session.user
