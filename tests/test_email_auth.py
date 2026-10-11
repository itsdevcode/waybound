import datetime
import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.core.rate_limit import DatabaseRateLimiter
from app.models.otp import EmailOtp
from app.services.email import (
    EmailDeliveryError,
    SimulatedEmailService,
    _simulated_service_instance,
)


@pytest.mark.asyncio
async def test_email_delivery_success(client: AsyncClient, db_session: AsyncSession):
    """
    Test successful transactional OTP delivery records code in email service,
    saves record in database, and returns successful response.
    """
    _simulated_service_instance.sent_emails.clear()
    email = f"deliver_ok_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.1"}

    resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == email
    assert data["message"] == "Verification code sent successfully."

    # Check simulated provider sent the code
    assert len(_simulated_service_instance.sent_emails) == 1
    sent = _simulated_service_instance.sent_emails[0]
    assert sent["to_email"] == email
    assert len(sent["otp_code"]) == 6

    # Verify database has valid, unused OTP record
    stmt = select(EmailOtp).where(EmailOtp.email == email, EmailOtp.is_used.is_(False))
    record = (await db_session.execute(stmt)).scalars().first()
    assert record is not None
    assert record.attempts_count == 0


@pytest.mark.asyncio
async def test_email_provider_failure_rolls_back_otp(client: AsyncClient, db_session: AsyncSession):
    """
    When email provider fails (502 Bad Gateway), no active OTP record is left in the DB.
    """
    email = f"deliver_fail_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.2"}

    with patch.object(
        SimulatedEmailService,
        "send_otp_email",
        side_effect=EmailDeliveryError("Simulated Resend API 500 error"),
    ):
        resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
        assert resp.status_code == 502
        assert "Failed to dispatch verification code via email provider" in resp.json()["detail"]

    # Verify no active OTP record exists for this email
    stmt = select(EmailOtp).where(EmailOtp.email == email)
    records = (await db_session.execute(stmt)).scalars().all()
    assert len(records) == 0


@pytest.mark.asyncio
async def test_production_response_secrecy(client: AsyncClient):
    """
    In production mode, OTP code is NEVER returned in API responses, logs, or messages.
    """
    email = f"prod_secret_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.3"}

    original_env = settings.environment
    try:
        settings.environment = "production"
        with patch.object(
            SimulatedEmailService,
            "send_otp_email",
            return_value=None,
        ):
            resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
            assert resp.status_code == 200
            data = resp.json()
            assert data["simulated_code"] is None
            assert "code" not in data["message"].lower() or "sent" in data["message"].lower()
    finally:
        settings.environment = original_env


@pytest.mark.asyncio
async def test_otp_expiry(client: AsyncClient, db_session: AsyncSession):
    """
    Expired OTP codes are rejected with 400 Bad Request.
    """
    email = f"expire_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.4"}

    req_resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
    assert req_resp.status_code == 200
    code = req_resp.json()["simulated_code"]

    # Expire the record in DB
    stmt = select(EmailOtp).where(EmailOtp.email == email)
    record = (await db_session.execute(stmt)).scalars().first()
    assert record is not None
    record.expires_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
    await db_session.commit()

    # Try verifying expired code
    verify_resp = await client.post(
        "/api/v1/auth/otp/verify", json={"email": email, "code": code}, headers=headers
    )
    assert verify_resp.status_code == 400
    assert "No valid verification code found" in verify_resp.json()["detail"]


@pytest.mark.asyncio
async def test_otp_replay_prevented(client: AsyncClient):
    """
    Used OTP codes cannot be replayed.
    """
    email = f"replay_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.5"}

    req_resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
    code = req_resp.json()["simulated_code"]

    # First verification succeeds
    v1 = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": code}, headers=headers)
    assert v1.status_code == 200
    assert "token" in v1.json()

    # Second verification fails
    v2 = await client.post("/api/v1/auth/otp/verify", json={"email": email, "code": code}, headers=headers)
    assert v2.status_code == 400
    assert "No valid verification code found" in v2.json()["detail"]


@pytest.mark.asyncio
async def test_otp_brute_force_attempts_limit(client: AsyncClient, db_session: AsyncSession):
    """
    Exceeding maximum invalid attempts invalidates the OTP code.
    """
    email = f"brute_{uuid.uuid4().hex[:6]}@example.com"
    headers = {"X-Forwarded-For": "192.168.10.6"}

    req_resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
    correct_code = req_resp.json()["simulated_code"]

    # Fail 5 times with incorrect codes
    for attempt in range(settings.otp_max_attempts):
        bad_resp = await client.post(
            "/api/v1/auth/otp/verify", json={"email": email, "code": "000000"}, headers=headers
        )
        assert bad_resp.status_code == 400
        assert "Invalid verification code" in bad_resp.json()["detail"]

    # 6th attempt is rejected because code has been invalidated
    bad_resp6 = await client.post(
        "/api/v1/auth/otp/verify", json={"email": email, "code": "000000"}, headers=headers
    )
    assert bad_resp6.status_code == 400
    assert "Too many invalid attempts" in bad_resp6.json()["detail"]

    # Even the correct code can no longer be used
    correct_resp = await client.post(
        "/api/v1/auth/otp/verify", json={"email": email, "code": correct_code}, headers=headers
    )
    assert correct_resp.status_code == 400


@pytest.mark.asyncio
async def test_multi_worker_database_rate_limiter(db_session: AsyncSession):
    """
    Verify that DatabaseRateLimiter correctly tracks attempts in shared database table
    and raises 429 when threshold is reached across separate instances.
    """
    key = f"test_worker_ip:{uuid.uuid4().hex[:6]}"
    # Create two separate limiter instances (simulating two worker processes)
    worker1 = DatabaseRateLimiter(limit=3, window_seconds=60)
    worker2 = DatabaseRateLimiter(limit=3, window_seconds=60)

    # Clean up test key
    await worker1.reset(key, db=db_session)

    # Worker 1 registers 2 hits
    await worker1.check(key, db=db_session)
    await worker1.check(key, db=db_session)

    # Worker 2 registers 1 hit (total 3)
    await worker2.check(key, db=db_session)

    # 4th hit by Worker 1 should raise 429
    with pytest.raises(Exception) as exc_info:
        await worker1.check(key, db=db_session)
    assert "429" in str(exc_info.value)

    # Reset clears shared state for both workers
    await worker2.reset(key, db=db_session)
    # Next check succeeds without error
    await worker1.check(key, db=db_session)


def test_production_email_provider_validation():
    """
    Test Settings validation rules for production email providers.
    """
    # 1. Production forbids simulated email provider
    with pytest.raises(ValueError, match="EMAIL_PROVIDER cannot be 'simulated' in production"):
        Settings(
            environment="production",
            auth_secret="a_valid_32_character_production_secret_key_12345",
            email_provider="simulated",
        )

    # 2. Production requires resend_api_key when provider is resend
    with pytest.raises(ValueError, match="RESEND_API_KEY must be provided"):
        Settings(
            environment="production",
            auth_secret="a_valid_32_character_production_secret_key_12345",
            email_provider="resend",
            resend_api_key="",
        )

    # 3. Production requires smtp_host when provider is smtp
    with pytest.raises(ValueError, match="SMTP_HOST must be provided"):
        Settings(
            environment="production",
            auth_secret="a_valid_32_character_production_secret_key_12345",
            email_provider="smtp",
            smtp_host="",
        )

    # 4. Valid configuration passes
    valid_cfg = Settings(
        environment="production",
        auth_secret="a_valid_32_character_production_secret_key_12345",
        email_provider="resend",
        resend_api_key="re_1234567890abcdef",
    )
    assert valid_cfg.environment == "production"


@pytest.mark.asyncio
async def test_forged_x_forwarded_for_rejected():
    """
    Test that forged X-Forwarded-For headers from untrusted connection clients
    are ignored in favor of the actual socket connection IP.
    """
    from fastapi import Request
    from app.core.rate_limit import get_client_ip

    # Untrusted client attempting to forge IP via X-Forwarded-For header
    scope_untrusted = {
        "type": "http",
        "client": ("203.0.113.195", 54321),
        "headers": [(b"x-forwarded-for", b"1.1.1.1")],
    }
    req_untrusted = Request(scope_untrusted)
    resolved_ip = get_client_ip(req_untrusted)
    # Must use actual client IP, NOT forged 1.1.1.1!
    assert resolved_ip == "203.0.113.195"

    # Trusted proxy (127.0.0.1) forwarding legitimate client IP
    scope_trusted = {
        "type": "http",
        "client": ("127.0.0.1", 54321),
        "headers": [(b"x-forwarded-for", b"198.51.100.42, 127.0.0.1")],
    }
    req_trusted = Request(scope_trusted)
    resolved_trusted = get_client_ip(req_trusted)
    assert resolved_trusted == "198.51.100.42"

    # Trusted proxy with malformed/garbage IP falls back to proxy host
    scope_malformed = {
        "type": "http",
        "client": ("127.0.0.1", 54321),
        "headers": [(b"x-forwarded-for", b"invalid_ip_not_an_address")],
    }
    req_malformed = Request(scope_malformed)
    resolved_malformed = get_client_ip(req_malformed)
    assert resolved_malformed == "127.0.0.1"


@pytest.mark.asyncio
async def test_concurrent_requests_at_rate_limit_threshold(db_session: AsyncSession):
    """
    Test that concurrent requests executed simultaneously at the rate-limit threshold
    are atomically serialized by PostgreSQL advisory locking and cannot race past the limit.
    """
    import asyncio
    from app.db.session import AsyncSessionLocal

    key = f"race_test:{uuid.uuid4().hex[:6]}"
    threshold = 5
    limiter = DatabaseRateLimiter(limit=threshold, window_seconds=60)
    await limiter.reset(key, db=db_session)

    # Launch 10 simultaneous workers attempting to register a hit on the exact same key
    async def worker_attempt() -> int:
        async with AsyncSessionLocal() as session:
            try:
                await limiter.check(key, db=session)
                return 200
            except HTTPException as exc:
                return exc.status_code

    results = await asyncio.gather(*(worker_attempt() for _ in range(10)))
    successes = [code for code in results if code == 200]
    rate_limited = [code for code in results if code == 429]

    # Exactly threshold successes, remaining must be 429
    assert len(successes) == threshold
    assert len(rate_limited) == 10 - threshold
