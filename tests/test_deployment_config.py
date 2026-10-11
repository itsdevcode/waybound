from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import HTTPException, Request
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.rate_limit import DatabaseRateLimiter, get_client_ip
from app.main import app


def test_async_database_url_normalization() -> None:
    # Render postgresql format
    s1 = Settings(database_url="postgres://user:secret@dpg-xxx.oregon-postgres.render.com/waybound")
    assert s1.async_database_url == "postgresql+asyncpg://user:secret@dpg-xxx.oregon-postgres.render.com/waybound"

    s2 = Settings(database_url="postgresql://user:secret@dpg-xxx.oregon-postgres.render.com/waybound")
    assert s2.async_database_url == "postgresql+asyncpg://user:secret@dpg-xxx.oregon-postgres.render.com/waybound"

    s3 = Settings(database_url="postgresql+asyncpg://user:secret@localhost:5432/waybound")
    assert s3.async_database_url == "postgresql+asyncpg://user:secret@localhost:5432/waybound"


def test_cors_origins_normalization() -> None:
    s_default = Settings(cors_origins="*")
    assert s_default.cors_origins_list == ["*"]

    s_custom = Settings(cors_origins="waybound-frontend.onrender.com,http://localhost:3000")
    origins = s_custom.cors_origins_list
    assert "https://waybound-frontend.onrender.com" in origins
    assert "http://localhost:3000" in origins


def test_production_security_validation() -> None:
    # Production with default/insecure auth secret must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="short",
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="https://waybound-frontend.onrender.com",
        )

    # Production with simulated email must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="simulated",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="https://waybound-frontend.onrender.com",
        )

    # Production with resend but missing api key must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="https://waybound-frontend.onrender.com",
        )

    # Production with wildcard CORS must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="*",
        )

    # Production with unverified placeholder email_from must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <auth@waybound.dev>",
            cors_origins="https://waybound-frontend.onrender.com",
        )

    # Valid production settings automatically disable demo auth and enforce HTTPS
    valid_prod = Settings(
        environment="production",
        auth_secret="a" * 32,
        email_provider="resend",
        resend_api_key="re_sample_production_key",
        email_from="WAYBOUND <auth@verified-domain.com>",
        cors_origins="https://waybound-frontend.onrender.com",
    )
    assert valid_prod.allow_demo_auth is False
    assert valid_prod.environment == "production"
    assert "https://waybound-frontend.onrender.com" in valid_prod.cors_origins_list


@pytest.mark.asyncio
async def test_health_endpoints() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Liveness check
        resp = await client.get("/health")
        assert resp.status_code == 200
        raw_data = cast(dict[str, str], resp.json())
        assert raw_data["status"] == "ok"
        assert "app" in raw_data
        assert "version" in raw_data

        # Readiness check (probes database)
        ready_resp = await client.get("/health/ready")
        assert ready_resp.status_code == 200
        raw_ready = cast(dict[str, str], ready_resp.json())
        assert raw_ready["status"] == "ready"
        assert raw_ready["database"] == "connected"


@pytest.mark.asyncio
async def test_readiness_probe_sanitized_on_database_failure() -> None:
    # Ensure raw exception details are never leaked in public responses
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        mock_engine = MagicMock()
        mock_engine.connect.side_effect = RuntimeError("FATAL: password authentication failed for user 'internal_db_user'")
        with patch("app.main.engine", mock_engine):
            resp = await client.get("/health/ready")
            assert resp.status_code == 503
            data = cast(dict[str, str], resp.json())
            assert data["status"] == "unhealthy"
            assert data["database"] == "disconnected"
            # Must NOT expose raw database error or credentials
            assert "error" not in data
            assert "password" not in str(data)
            assert "internal_db_user" not in str(data)


def test_client_ip_reverse_proxy_security() -> None:
    def make_request(client_host: str, headers: dict[str, str]) -> Request:
        scope = {
            "type": "http",
            "client": (client_host, 50000),
            "headers": [(k.lower().encode("latin1"), v.encode("latin1")) for k, v in headers.items()],
        }
        return Request(scope)

    # 1. Direct untrusted client attempting to spoof X-Forwarded-For
    req1 = make_request("198.51.100.25", {"x-forwarded-for": "8.8.8.8"})
    assert get_client_ip(req1) == "198.51.100.25"

    # 2. Connection from trusted proxy (127.0.0.1) with client-injected spoofed IP in X-Forwarded-For
    # Forwarded header: client_spoofed_ip, real_client_ip
    # System parses right-to-left and extracts authentic real_client_ip
    req2 = make_request("127.0.0.1", {"x-forwarded-for": "1.1.1.1, 203.0.113.88"})
    assert get_client_ip(req2) == "203.0.113.88"

    # 3. Connection from trusted proxy with X-Real-IP set by edge
    req3 = make_request("127.0.0.1", {"x-real-ip": "203.0.113.99", "x-forwarded-for": "1.1.1.1"})
    assert get_client_ip(req3) == "203.0.113.99"


@pytest.mark.asyncio
async def test_database_rate_limiter_fail_closed_on_lock_failure() -> None:
    limiter = DatabaseRateLimiter(limit=5, window_seconds=60)
    mock_db = AsyncMock()

    # Configure mock_db dialect to simulate PostgreSQL
    mock_bind = MagicMock()
    mock_bind.dialect.name = "postgresql"
    mock_db.bind = mock_bind
    mock_db.get_bind = MagicMock(return_value=mock_bind)

    # Simulate database advisory lock failure (e.g. lock acquisition deadlock or timeout)
    mock_db.execute.side_effect = RuntimeError("deadlock detected on advisory lock")

    with pytest.raises(HTTPException) as exc_info:
        await limiter.check("test_user_key", db=mock_db)

    # Must fail closed with 503 instead of proceeding without atomic lock
    assert exc_info.value.status_code == 503
    assert "temporarily unavailable" in str(exc_info.value.detail)
    mock_db.rollback.assert_awaited()
