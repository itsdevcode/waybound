import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.security import create_session_token, hash_token
from app.db.session import get_session
from app.models.profile import Profile
from app.models.session import Session
from app.models.user import User
from app.schemas.party import AuthMeResponse, SessionCreateRequest, SessionResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)


@router.post(
    "/session",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create authenticated explorer session",
    description="Authenticates an explorer and issues a server-side opaque Bearer session token.",
)
async def create_session(
    request: SessionCreateRequest,
    db: AsyncSession = Depends(get_session),
) -> SessionResponse:
    stmt = select(User).options(selectinload(User.profile)).where(User.id == request.user_id)
    result = await db.execute(stmt)
    user = result.scalars().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Explorer user {request.user_id} not found",
        )

    raw_token = create_session_token()
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_token_expire_days)

    db_session = Session(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(db_session)
    await db.commit()

    profile = user.profile
    explorer_type = profile.explorer_type if profile else "mystery"
    level = profile.level if profile else 1
    xp = profile.xp if profile else 0

    return SessionResponse(
        token=raw_token,
        user_id=user.id,
        user_name=user.name,
        explorer_type=explorer_type,
        level=level,
        xp=xp,
        expires_at=expires_at,
    )


@router.get(
    "/me",
    response_model=AuthMeResponse,
    summary="Get current authenticated user identity",
    description="Verifies session token and retrieves authenticated explorer information.",
)
async def get_me(
    current_user: User = Depends(get_current_user),
) -> AuthMeResponse:
    profile = current_user.profile
    return AuthMeResponse(
        user_id=current_user.id,
        user_name=current_user.name,
        email=current_user.email,
        explorer_type=profile.explorer_type if profile else "mystery",
        level=profile.level if profile else 1,
        xp=profile.xp if profile else 0,
    )
