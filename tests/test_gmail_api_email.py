"""
Unit tests for app.services.email.GmailApiEmailService.

All external HTTPS calls (Google token endpoint and Gmail API) are mocked
with httpx responders / AsyncMock so no real network calls are made.
Credentials and OTP values must never appear in log output.
"""

from __future__ import annotations

import base64
import logging
from email import message_from_bytes
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.email import (
    EmailDeliveryError,
    GmailApiEmailService,
    get_email_service,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_CREDS = dict(
    client_id="fake_client_id",
    client_secret="fake_client_secret",
    refresh_token="fake_refresh_token",
    sender_email="WAYBOUND <waybound@example.com>",
)

_GOOD_TOKEN_RESPONSE = httpx.Response(200, json={"access_token": "fake_access_token", "expires_in": 3599})
_GOOD_SEND_RESPONSE = httpx.Response(200, json={"id": "msg_abc123"})


def _make_service(**overrides: str) -> GmailApiEmailService:
    kwargs = {**_FAKE_CREDS, **overrides}
    return GmailApiEmailService(**kwargs)


def _mock_client(*responses: httpx.Response) -> AsyncMock:
    """
    Returns a mock httpx.AsyncClient context manager that yields sequential responses.
    ``responses[0]`` is returned for the token endpoint, ``responses[1]`` for Gmail send, etc.
    """
    response_iter = iter(responses)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(side_effect=lambda *_a, **_kw: next(response_iter))
    return mock_client


# ---------------------------------------------------------------------------
# Successful send
# ---------------------------------------------------------------------------


class TestGmailApiSuccessfulSend:
    @pytest.mark.asyncio
    async def test_successful_email_sends_without_error(self) -> None:
        """
        When both the token endpoint and the Gmail API respond with 200,
        send_otp_email completes without raising and does not log OTP value.
        """
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "123456")

        assert mock_client.post.call_count == 2

    @pytest.mark.asyncio
    async def test_token_endpoint_url_is_correct(self) -> None:
        """Token refresh must target the canonical Google OAuth2 token endpoint."""
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "999888")

        token_call = mock_client.post.call_args_list[0]
        assert token_call.args[0] == "https://oauth2.googleapis.com/token"

    @pytest.mark.asyncio
    async def test_gmail_send_url_is_correct(self) -> None:
        """Email delivery must target the Gmail v1 messages.send endpoint."""
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "111222")

        send_call = mock_client.post.call_args_list[1]
        assert send_call.args[0] == "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

    @pytest.mark.asyncio
    async def test_access_token_used_in_authorization_header(self) -> None:
        """The Bearer token from the token endpoint is used in the Gmail API call."""
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "333444")

        send_call = mock_client.post.call_args_list[1]
        headers: dict[str, str] = send_call.kwargs["headers"]
        assert headers["Authorization"] == "Bearer fake_access_token"

    @pytest.mark.asyncio
    async def test_otp_value_never_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        """The OTP code must NOT appear anywhere in log output."""
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with caplog.at_level(logging.DEBUG), patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "999777")

        assert "999777" not in caplog.text

    @pytest.mark.asyncio
    async def test_credentials_never_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        """Refresh token and client secret must NOT appear anywhere in log output."""
        service = _make_service()
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, _GOOD_SEND_RESPONSE)

        with caplog.at_level(logging.DEBUG), patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            await service.send_otp_email("explorer@example.com", "000111")

        assert "fake_refresh_token" not in caplog.text
        assert "fake_client_secret" not in caplog.text
        assert "fake_access_token" not in caplog.text


# ---------------------------------------------------------------------------
# Token refresh failures
# ---------------------------------------------------------------------------


class TestGmailApiTokenRefreshFailures:
    @pytest.mark.asyncio
    async def test_invalid_grant_raises_delivery_error(self) -> None:
        """``invalid_grant`` from the token endpoint raises EmailDeliveryError with clear message."""
        service = _make_service()
        revoked_response = httpx.Response(400, json={"error": "invalid_grant"})
        mock_client = _mock_client(revoked_response)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="invalid or revoked"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_token_401_raises_delivery_error(self) -> None:
        """HTTP 401 from token endpoint raises EmailDeliveryError about client credentials."""
        service = _make_service()
        unauth = httpx.Response(401, json={"error": "unauthorized_client"})
        mock_client = _mock_client(unauth)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="unauthorized"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_token_500_raises_delivery_error(self) -> None:
        """Unexpected HTTP status from token endpoint raises EmailDeliveryError."""
        service = _make_service()
        server_err = httpx.Response(500, json={"error": "internal_error"})
        mock_client = _mock_client(server_err)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="HTTP 500"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_token_generic_400_raises_delivery_error(self) -> None:
        """Non-invalid_grant 400 errors from the token endpoint raise EmailDeliveryError."""
        service = _make_service()
        bad_req = httpx.Response(400, json={"error": "redirect_uri_mismatch"})
        mock_client = _mock_client(bad_req)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="redirect_uri_mismatch"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_token_network_error_raises_delivery_error(self) -> None:
        """Network errors reaching the token endpoint raise EmailDeliveryError."""
        service = _make_service()
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="Network error"):
                await service.send_otp_email("explorer@example.com", "123456")


# ---------------------------------------------------------------------------
# Gmail API send failures
# ---------------------------------------------------------------------------


class TestGmailApiSendFailures:
    @pytest.mark.asyncio
    async def test_gmail_api_401_raises_delivery_error(self) -> None:
        """HTTP 401 from Gmail API means the access token was rejected."""
        service = _make_service()
        gmail_unauth = httpx.Response(401, json={"error": {"code": 401}})
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, gmail_unauth)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="rejected the access token"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_gmail_api_429_quota_raises_delivery_error(self) -> None:
        """HTTP 429 from Gmail API raises EmailDeliveryError mentioning quota."""
        service = _make_service()
        quota_exceeded = httpx.Response(429, json={"error": {"code": 429, "message": "Quota exceeded"}})
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, quota_exceeded)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="quota exceeded"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_gmail_api_500_raises_delivery_error(self) -> None:
        """HTTP 5xx from Gmail API raises EmailDeliveryError."""
        service = _make_service()
        server_err = httpx.Response(503, json={"error": "backend_error"})
        mock_client = _mock_client(_GOOD_TOKEN_RESPONSE, server_err)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="HTTP 503"):
                await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_gmail_send_network_error_raises_delivery_error(self) -> None:
        """Network errors during Gmail send raise EmailDeliveryError."""
        service = _make_service()

        call_count = 0

        async def _side_effect(*_args: Any, **_kwargs: Any) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _GOOD_TOKEN_RESPONSE
            raise httpx.TimeoutException("Request timed out")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=_side_effect)

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError, match="Network error"):
                await service.send_otp_email("explorer@example.com", "123456")


# ---------------------------------------------------------------------------
# Missing credentials guard
# ---------------------------------------------------------------------------


class TestGmailApiMissingCredentials:
    @pytest.mark.asyncio
    async def test_raises_when_client_id_missing(self) -> None:
        service = _make_service(client_id="")
        with pytest.raises(EmailDeliveryError, match="not fully configured"):
            await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_raises_when_client_secret_missing(self) -> None:
        service = _make_service(client_secret="")
        with pytest.raises(EmailDeliveryError, match="not fully configured"):
            await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_raises_when_refresh_token_missing(self) -> None:
        service = _make_service(refresh_token="")
        with pytest.raises(EmailDeliveryError, match="not fully configured"):
            await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_raises_when_sender_email_missing(self) -> None:
        service = _make_service(sender_email="")
        with pytest.raises(EmailDeliveryError, match="not fully configured"):
            await service.send_otp_email("explorer@example.com", "123456")

    @pytest.mark.asyncio
    async def test_no_http_calls_when_credentials_missing(self) -> None:
        """When credentials are missing, no HTTP calls should be made."""
        service = _make_service(refresh_token="")
        mock_client = MagicMock()

        with patch("app.services.email.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(EmailDeliveryError):
                await service.send_otp_email("explorer@example.com", "123456")

        mock_client.post.assert_not_called()


# ---------------------------------------------------------------------------
# Raw MIME message construction
# ---------------------------------------------------------------------------


class TestGmailApiRawMessageEncoding:
    def test_raw_message_is_valid_base64url(self) -> None:
        """_build_raw_message must return a valid base64url-encoded string."""
        service = _make_service()
        raw = service._build_raw_message("explorer@example.com", "654321")
        # Must decode without error
        decoded_bytes = base64.urlsafe_b64decode(raw + "==")  # pad for safety
        assert len(decoded_bytes) > 0

    def test_raw_message_contains_correct_recipient(self) -> None:
        """Decoded MIME message must have To header matching the recipient."""
        service = _make_service()
        raw = service._build_raw_message("recipient@example.com", "654321")
        decoded_bytes = base64.urlsafe_b64decode(raw + "==")
        msg = message_from_bytes(decoded_bytes)
        assert "recipient@example.com" in (msg["To"] or "")

    def test_raw_message_has_waybound_subject(self) -> None:
        """Decoded MIME message must have the WAYBOUND subject line."""
        service = _make_service()
        raw = service._build_raw_message("recipient@example.com", "654321")
        decoded_bytes = base64.urlsafe_b64decode(raw + "==")
        msg = message_from_bytes(decoded_bytes)
        assert "WAYBOUND" in (msg["Subject"] or "")

    def test_raw_message_does_not_contain_otp_in_subject(self) -> None:
        """OTP code must not appear in the Subject header."""
        service = _make_service()
        raw = service._build_raw_message("recipient@example.com", "654321")
        decoded_bytes = base64.urlsafe_b64decode(raw + "==")
        msg = message_from_bytes(decoded_bytes)
        assert "654321" not in (msg["Subject"] or "")


# ---------------------------------------------------------------------------
# Factory routing
# ---------------------------------------------------------------------------


class TestGetEmailServiceFactory:
    def test_gmail_api_provider_returns_gmail_service(self) -> None:
        """get_email_service() with EMAIL_PROVIDER=gmail_api returns GmailApiEmailService."""
        from app.core.config import Settings

        fake_settings = Settings(
            email_provider="gmail_api",
            gmail_client_id="cid",
            gmail_client_secret="csecret",
            gmail_refresh_token="rtoken",
            gmail_sender_email="sender@example.com",
        )
        with patch("app.services.email.settings", fake_settings):
            svc = get_email_service()

        assert isinstance(svc, GmailApiEmailService)

    def test_unknown_provider_raises_value_error(self) -> None:
        """get_email_service() with an unrecognised provider raises ValueError."""
        from app.core.config import Settings

        fake_settings = Settings(email_provider="carrier_pigeon")
        with patch("app.services.email.settings", fake_settings):
            with pytest.raises(ValueError, match="Unknown EMAIL_PROVIDER"):
                get_email_service()


# ---------------------------------------------------------------------------
# Production config validation
# ---------------------------------------------------------------------------


class TestProductionConfigGmailValidation:
    def test_gmail_api_requires_all_four_credentials_in_production(self) -> None:
        """Production startup must fail if any Gmail credential is missing."""
        from pydantic import ValidationError

        from app.core.config import Settings

        _base = dict(
            environment="production",
            auth_secret="a" * 32,
            email_provider="gmail_api",
            email_from="WAYBOUND <auth@verified-domain.com>",
            cors_origins="https://waybound-frontend.onrender.com",
        )

        # Each missing field should independently fail validation
        for missing_field in ("gmail_client_id", "gmail_client_secret", "gmail_refresh_token", "gmail_sender_email"):
            credentials = dict(
                gmail_client_id="cid",
                gmail_client_secret="csecret",
                gmail_refresh_token="rtoken",
                gmail_sender_email="sender@verified-domain.com",
            )
            credentials[missing_field] = ""
            with pytest.raises(ValidationError, match=missing_field.upper()):
                _ = Settings(**{**_base, **credentials})

    def test_valid_production_gmail_config_passes_validation(self) -> None:
        """A fully supplied gmail_api config in production must pass Settings validation."""
        from app.core.config import Settings

        valid = Settings(
            environment="production",
            auth_secret="a" * 32,
            email_provider="gmail_api",
            email_from="WAYBOUND <auth@verified-domain.com>",
            cors_origins="https://waybound-frontend.onrender.com",
            gmail_client_id="real_client_id",
            gmail_client_secret="real_client_secret",
            gmail_refresh_token="real_refresh_token",
            gmail_sender_email="sender@verified-domain.com",
        )
        assert valid.email_provider == "gmail_api"
        assert valid.allow_demo_auth is False
