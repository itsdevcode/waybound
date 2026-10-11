import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_session, get_current_user
from app.core.config import settings
from app.core.rate_limit import auth_rate_limiter, get_client_ip
from app.core.security import (
    create_session_token,
    generate_otp_code,
    hash_otp,
    hash_token,
    verify_otp_hash,
)
from app.services.email import EmailDeliveryError, get_email_service
from app.db.session import get_session
from app.models.otp import EmailOtp
from app.models.profile import Profile
from app.models.session import Session
from app.models.user import User
from app.schemas.party import (
    AuthMeResponse,
    DemoSessionRequest,
    EmailOtpRequest,
    EmailOtpResponse,
    EmailOtpVerifyRequest,
    LogoutResponse,
    SessionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEMO_EMAIL = "explorer@waybound.dev"


@router.post(
    "/otp/request",
    response_model=EmailOtpResponse,
    summary="Request email verification OTP",
    description="Sends a 6-digit verification code to the explorer's email with rate limiting.",
)
async def request_email_otp(
    request: EmailOtpRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_session),
) -> EmailOtpResponse:
    client_ip = get_client_ip(http_request)
    await auth_rate_limiter.check(f"otp_req:{client_ip}", db=db)
    await auth_rate_limiter.check(f"otp_req_email:{request.email.lower()}", db=db)

    raw_code = generate_otp_code()
    code_hash = hash_otp(request.email, raw_code)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.otp_expire_minutes)

    otp_record = EmailOtp(
        email=request.email.lower().strip(),
        code_hash=code_hash,
        expires_at=expires_at,
        attempts_count=0,
        is_used=False,
    )
    db.add(otp_record)
    await db.flush()

    # Dispatch via configured transactional email provider (Resend, SMTP, or simulated)
    email_service = get_email_service()
    try:
        await email_service.send_otp_email(to_email=request.email.lower().strip(), otp_code=raw_code)
    except EmailDeliveryError as exc:
        logger.error("Transactional email delivery failed for %s", request.email)
        # Roll back OTP record so failed sends never leave active unusable OTP records in DB
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to dispatch verification code via email provider. Please try again shortly.",
        ) from exc
    except Exception as exc:
        logger.error("Unexpected error during OTP email delivery for %s", request.email)
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while dispatching verification code.",
        ) from exc

    # Only commit after provider confirms successful delivery acceptance
    await db.commit()

    logger.info("Successfully dispatched proof-of-identity OTP to %s", request.email)

    # In development and test environments, provide simulated_code so automated flows run cleanly
    # In production, NEVER return OTP code in response, logs, or messages
    simulated = raw_code if settings.environment != "production" else None

    return EmailOtpResponse(
        message="Verification code sent successfully.",
        email=request.email.lower().strip(),
        expires_in_seconds=settings.otp_expire_minutes * 60,
        simulated_code=simulated,
    )


@router.post(
    "/otp/verify",
    response_model=SessionResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify email OTP and issue authenticated session",
    description="Validates OTP code, marks it used, and creates a secure Bearer session.",
)
async def verify_email_otp(
    request: EmailOtpVerifyRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_session),
) -> SessionResponse:
    client_ip = get_client_ip(http_request)
    await auth_rate_limiter.check(f"otp_verify:{client_ip}", db=db)

    email = request.email.lower().strip()
    now = datetime.now(timezone.utc)

    # Find latest unexpired, unused OTP record for email
    stmt = (
        select(EmailOtp)
        .where(
            EmailOtp.email == email,
            EmailOtp.is_used.is_(False),
            EmailOtp.expires_at > now,
        )
        .order_by(EmailOtp.created_at.desc())
    )
    otp_record = (await db.execute(stmt)).scalars().first()

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid verification code found. Please request a new code.",
        )

    if otp_record.attempts_count >= settings.otp_max_attempts:
        otp_record.is_used = True
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many invalid attempts. This verification code has been invalidated.",
        )

    if not verify_otp_hash(email, request.code.strip(), otp_record.code_hash):
        otp_record.attempts_count += 1
        await db.commit()
        remaining = settings.otp_max_attempts - otp_record.attempts_count
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid verification code. {max(0, remaining)} attempt(s) remaining.",
        )

    # Burn OTP on success
    otp_record.is_used = True

    # Look up user or create new explorer user
    user_stmt = select(User).options(selectinload(User.profile)).where(User.email == email)
    user = (await db.execute(user_stmt)).scalars().first()

    if not user:
        name_prefix = email.split("@")[0].replace(".", " ").title()[:50]
        user = User(
            name=name_prefix or "Explorer",
            email=email,
        )
        db.add(user)
        await db.flush()

        profile = Profile(
            user_id=user.id,
            explorer_type="mystery",
            level=1,
            xp=0,
        )
        db.add(profile)
        await db.flush()
        user.profile = profile

    raw_token = create_session_token()
    token_hash = hash_token(raw_token)
    expires_at = now + timedelta(days=settings.session_token_expire_days)

    db_session = Session(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(db_session)
    await db.commit()

    profile = user.profile
    return SessionResponse(
        token=raw_token,
        user_id=user.id,
        user_name=user.name,
        explorer_type=profile.explorer_type if profile else "mystery",
        level=profile.level if profile else 1,
        xp=profile.xp if profile else 0,
        expires_at=expires_at,
    )


@router.post(
    "/demo-session",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create isolated demo explorer session",
    description="Available strictly for demo/development environments. Disabled in production.",
)
async def create_demo_session(
    request: DemoSessionRequest,
    db: AsyncSession = Depends(get_session),
) -> SessionResponse:
    if settings.environment == "production" or not settings.allow_demo_auth:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo authentication is strictly disabled in production. Authenticate via verified email OTP.",
        )

    # Security check: Only allow seeded demo identity; reject arbitrary user UUIDs!
    if request.user_id is not None and request.user_id != DEMO_USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo authentication is only permitted for the seeded demo explorer identity.",
        )
    if request.email is not None and request.email.lower() != DEMO_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo authentication is only permitted for the seeded demo explorer identity.",
        )

    target_user_id = request.user_id or DEMO_USER_ID
    stmt = select(User).options(selectinload(User.profile)).where(User.id == target_user_id)
    result = await db.execute(stmt)
    user = result.scalars().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo explorer account not found. Please run scripts/seed_demo_user.py.",
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
    return SessionResponse(
        token=raw_token,
        user_id=user.id,
        user_name=user.name,
        explorer_type=profile.explorer_type if profile else "mystery",
        level=profile.level if profile else 1,
        xp=profile.xp if profile else 0,
        expires_at=expires_at,
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    summary="Revoke current authenticated session",
    description="Revokes the active Bearer session token so it cannot be used again.",
)
async def logout(
    current_session: Session = Depends(get_current_session),
    db: AsyncSession = Depends(get_session),
) -> LogoutResponse:
    current_session.is_revoked = True
    await db.commit()
    return LogoutResponse(
        success=True,
        message="Session revoked successfully.",
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
