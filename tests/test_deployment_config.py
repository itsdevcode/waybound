from typing import cast
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
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
    assert "waybound-frontend.onrender.com" in origins
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
        )

    # Production with simulated email must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="simulated",
        )

    # Production with resend but missing api key must fail
    with pytest.raises(ValidationError):
        _ = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="resend",
            resend_api_key="",
        )

    # Valid production settings automatically disable demo auth
    valid_prod = Settings(
        environment="production",
        auth_secret="a" * 32,
        email_provider="resend",
        resend_api_key="re_sample_production_key",
    )
    assert valid_prod.allow_demo_auth is False
    assert valid_prod.environment == "production"


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
