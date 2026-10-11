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

    # Production with empty CORS must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="",
        )

    # Production with internal bare hostname CORS must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="waybound-frontend",
        )

    # Production with internal bare hostname HTTPS CORS must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="https://waybound-frontend",
        )

    # Production with insecure HTTP CORS must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="re_valid_key",
            email_from="WAYBOUND <onboarding@resend.dev>",
            cors_origins="http://waybound-frontend.onrender.com",
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

    # Valid multiple production origins
    valid_multi = Settings(
        environment="production",
        auth_secret="a" * 32,
        email_provider="resend",
        resend_api_key="re_sample_production_key",
        email_from="WAYBOUND <auth@verified-domain.com>",
        cors_origins="https://waybound-frontend.onrender.com, https://explorer.waybound.dev",
    )
    assert "https://waybound-frontend.onrender.com" in valid_multi.cors_origins_list
    assert "https://explorer.waybound.dev" in valid_multi.cors_origins_list


def test_render_blueprint_environment_wiring() -> None:
    from pathlib import Path
    import yaml

    blueprint_path = Path(__file__).resolve().parent.parent / "render.yaml"
    assert blueprint_path.exists(), "render.yaml blueprint must exist"

    with open(blueprint_path, "r", encoding="utf-8") as f:
        blueprint = yaml.safe_load(f)

    assert blueprint.get("version") == "1"
    databases = {db["name"]: db for db in blueprint.get("databases", [])}
    assert "waybound-db" in databases

    services = {svc["name"]: svc for svc in blueprint.get("services", [])}
    assert "waybound-backend" in services
    assert "waybound-frontend" in services

    backend = services["waybound-backend"]
    backend_env = {item["key"]: item for item in backend.get("envVars", [])}

    # Verify CORS_ORIGINS is an explicit public HTTPS URL, not fromService or wildcard
    assert "CORS_ORIGINS" in backend_env
    cors_item = backend_env["CORS_ORIGINS"]
    assert "fromService" not in cors_item, "CORS_ORIGINS must not use fromService which provides internal hostnames and causes circular dependency"
    assert cors_item.get("sync") is False, "CORS_ORIGINS must have sync: false to allow dashboard overrides"
    assert "value" in cors_item
    cors_val = cors_item["value"]
    assert cors_val.startswith("https://"), f"CORS_ORIGINS value '{cors_val}' must start with https://"
    assert "." in cors_val.replace("https://", ""), f"CORS_ORIGINS value '{cors_val}' must be a public domain, not an internal hostname"
    assert "*" not in cors_val

    frontend = services["waybound-frontend"]
    frontend_env = {item["key"]: item for item in frontend.get("envVars", [])}

    # Verify NEXT_PUBLIC_API_URL is an explicit public HTTPS URL
    assert "NEXT_PUBLIC_API_URL" in frontend_env
    api_url_item = frontend_env["NEXT_PUBLIC_API_URL"]
    assert "fromService" not in api_url_item, "NEXT_PUBLIC_API_URL must not use fromService which injects unresolvable internal hostnames to browser client"
    assert api_url_item.get("sync") is False
    assert "value" in api_url_item
    api_url_val = api_url_item["value"]
    assert api_url_val.startswith("https://")
    assert "." in api_url_val.replace("https://", "")

    # Verify BACKEND_URL is an absolute URL
    assert "BACKEND_URL" in frontend_env
    backend_url_item = frontend_env["BACKEND_URL"]
    assert backend_url_item.get("sync") is False
    assert "value" in backend_url_item
    assert backend_url_item["value"].startswith("http://") or backend_url_item["value"].startswith("https://")


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
