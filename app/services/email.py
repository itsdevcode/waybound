import abc
import asyncio
import base64
import email.message
import email.mime.multipart
import email.mime.text
import logging
import smtplib
from typing import override

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)



class EmailDeliveryError(Exception):
    """Raised when OTP email delivery fails with a transactional email provider."""
    pass


class BaseEmailService(abc.ABC):
    @abc.abstractmethod
    async def send_otp_email(self, to_email: str, otp_code: str) -> None:
        """
        Sends the OTP code to recipient email.
        Must raise EmailDeliveryError if the provider fails to accept/send the message.
        """
        pass


class SimulatedEmailService(BaseEmailService):
    """
    Simulated email delivery for local development and testing.
    Records sent emails in-memory for testing assertions.
    """

    def __init__(self) -> None:
        self.sent_emails: list[dict[str, str]] = []

    @override
    async def send_otp_email(self, to_email: str, otp_code: str) -> None:
        if settings.environment == "production":
            raise EmailDeliveryError(
                "Simulated email service is strictly disabled in production. Configure RESEND or SMTP."
            )
        self.sent_emails.append({"to_email": to_email, "otp_code": otp_code})
        logger.info("Simulated email service dispatched OTP to %s", to_email)


class ResendEmailService(BaseEmailService):
    """
    Sends emails using the Resend transactional email API.
    Provider API key is kept strictly server-side.
    """

    def __init__(self, api_key: str, from_email: str) -> None:
        self.api_key = api_key
        self.from_email = from_email
        self.endpoint = "https://api.resend.com/emails"

    @override
    async def send_otp_email(self, to_email: str, otp_code: str) -> None:
        if not self.api_key:
            raise EmailDeliveryError("RESEND_API_KEY is not configured.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "from": self.from_email,
            "to": [to_email],
            "subject": "Your WAYBOUND Explorer Verification Code",
            "html": f"""
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h2 style="color: #0f172a; margin-top: 0;">WAYBOUND Authentication</h2>
                <p style="color: #475569;">Use the following 6-digit code to complete your explorer authentication:</p>
                <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a; border-radius: 6px; margin: 24px 0;">
                    {otp_code}
                </div>
                <p style="color: #64748b; font-size: 14px;">This code expires in {settings.otp_expire_minutes} minutes. If you did not request this code, you can safely ignore this email.</p>
            </div>
            """,
            "text": f"Your WAYBOUND verification code is: {otp_code}\nThis code expires in {settings.otp_expire_minutes} minutes.",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(self.endpoint, headers=headers, json=payload)
                if resp.status_code not in (200, 201):
                    logger.error(
                        "Resend API error: status=%d response=%s",
                        resp.status_code,
                        resp.text,
                    )
                    raise EmailDeliveryError(
                        f"Resend delivery failed with status code {resp.status_code}."
                    )
                logger.info("Resend successfully accepted email for %s", to_email)
        except httpx.RequestError as exc:
            logger.error("Resend HTTP request failed: %s", exc)
            raise EmailDeliveryError(f"Network error connecting to email provider: {exc}") from exc


class SMTPEmailService(BaseEmailService):
    """
    Sends emails using standard SMTP with STARTTLS / SSL support.
    """

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        from_email: str,
        use_tls: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.from_email = from_email
        self.use_tls = use_tls

    @override
    async def send_otp_email(self, to_email: str, otp_code: str) -> None:
        if not self.host:
            raise EmailDeliveryError("SMTP_HOST is not configured.")

        msg = email.message.EmailMessage()
        msg["Subject"] = "Your WAYBOUND Explorer Verification Code"
        msg["From"] = self.from_email
        msg["To"] = to_email
        msg.set_content(
            f"Your WAYBOUND verification code is: {otp_code}\nThis code expires in {settings.otp_expire_minutes} minutes."
        )

        def _send() -> None:
            server = smtplib.SMTP(self.host, self.port, timeout=10.0)
            try:
                if self.use_tls:
                    _ = server.starttls()
                if self.user and self.password:
                    _ = server.login(self.user, self.password)
                _ = server.send_message(msg)
            finally:
                _ = server.quit()

        try:
            await asyncio.to_thread(_send)
            logger.info("SMTP successfully delivered email for %s", to_email)
        except Exception as exc:
            logger.error("SMTP delivery failed for %s: %s", to_email, exc)
            raise EmailDeliveryError(f"SMTP delivery failed: {exc}") from exc


class GmailApiEmailService(BaseEmailService):
    """
    Sends emails through the Gmail REST API using OAuth 2.0 credentials.

    Authentication flow:
    1. Exchange the stored refresh token for a short-lived access token via
       ``https://oauth2.googleapis.com/token``.
    2. Construct a RFC-2822 MIME message, base64url-encode it, and POST it to
       ``https://gmail.googleapis.com/gmail/v1/users/me/messages/send``.

    Credentials (client_id, client_secret, refresh_token) are never written to
    logs. OTP values are also kept out of logs.

    Error handling:
    - ``400 invalid_grant`` / ``401`` from the token endpoint → likely a revoked
      or expired refresh token; raises EmailDeliveryError with actionable message.
    - ``429`` from Gmail API → quota exceeded; raises EmailDeliveryError.
    - Any non-2xx from Gmail API → raises EmailDeliveryError.
    - Network-level failures (DNS, timeout, connection refused) → raises
      EmailDeliveryError wrapping the original httpx.RequestError.

    Note on token caching:
    Access tokens are intentionally not cached across requests. A 1-hour TTL
    makes per-request refresh negligible in OTP flows (~1 token call per login
    attempt), and avoids stale-token race conditions in multi-worker deployments.
    """

    _TOKEN_URL = "https://oauth2.googleapis.com/token"
    _GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        sender_email: str,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._sender_email = sender_email

    async def _refresh_access_token(self, client: httpx.AsyncClient) -> str:
        """
        Exchanges the OAuth2 refresh token for a fresh access token.
        Never logs the token values.
        """
        try:
            resp = await client.post(
                self._TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                },
                timeout=10.0,
            )
        except httpx.RequestError as exc:
            logger.error("Gmail token refresh network error: %s", type(exc).__name__)
            raise EmailDeliveryError(
                f"Network error reaching Google token endpoint: {type(exc).__name__}"
            ) from exc

        if resp.status_code == 400:
            body = resp.json()
            error_code = body.get("error", "unknown")
            if error_code == "invalid_grant":
                logger.error(
                    "Gmail token refresh failed: invalid_grant. "
                    "The refresh token may be revoked or the OAuth consent may have expired."
                )
                raise EmailDeliveryError(
                    "Gmail OAuth2 refresh token is invalid or revoked. "
                    "Re-run the OAuth consent flow to obtain a new refresh token."
                )
            logger.error("Gmail token refresh 400 error: %s", error_code)
            raise EmailDeliveryError(
                f"Gmail token refresh failed with error '{error_code}'."
            )

        if resp.status_code == 401:
            logger.error("Gmail token refresh 401: Unauthorized. Check client credentials.")
            raise EmailDeliveryError(
                "Gmail token refresh unauthorized. Verify GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET."
            )

        if resp.status_code not in (200, 201):
            logger.error(
                "Gmail token refresh unexpected status: %d", resp.status_code
            )
            raise EmailDeliveryError(
                f"Gmail token refresh failed with HTTP {resp.status_code}."
            )

        return str(resp.json()["access_token"])

    def _build_raw_message(self, to_email: str, otp_code: str) -> str:
        """
        Constructs a multipart RFC-2822 MIME email and returns it as a
        base64url-encoded string suitable for the Gmail API ``raw`` field.
        """
        msg = email.mime.multipart.MIMEMultipart("alternative")
        msg["Subject"] = "Your WAYBOUND Explorer Verification Code"
        msg["From"] = self._sender_email
        msg["To"] = to_email

        text_body = (
            f"Your WAYBOUND verification code is: {otp_code}\n"
            f"This code expires in {settings.otp_expire_minutes} minutes.\n"
            "If you did not request this code, you can safely ignore this email."
        )
        html_body = f"""\
<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
    <h2 style="color: #0f172a; margin-top: 0;">WAYBOUND Authentication</h2>
    <p style="color: #475569;">Use the following 6-digit code to complete your explorer authentication:</p>
    <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a; border-radius: 6px; margin: 24px 0;">
        {otp_code}
    </div>
    <p style="color: #64748b; font-size: 14px;">This code expires in {settings.otp_expire_minutes} minutes. If you did not request this code, you can safely ignore this email.</p>
</div>"""

        msg.attach(email.mime.text.MIMEText(text_body, "plain", "utf-8"))
        msg.attach(email.mime.text.MIMEText(html_body, "html", "utf-8"))

        raw_bytes = msg.as_bytes()
        return base64.urlsafe_b64encode(raw_bytes).decode("ascii")

    @override
    async def send_otp_email(self, to_email: str, otp_code: str) -> None:
        if not all([self._client_id, self._client_secret, self._refresh_token, self._sender_email]):
            raise EmailDeliveryError(
                "Gmail API is not fully configured. "
                "Ensure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, "
                "and GMAIL_SENDER_EMAIL are all set."
            )

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                access_token = await self._refresh_access_token(client)

                raw_message = self._build_raw_message(to_email, otp_code)

                try:
                    resp = await client.post(
                        self._GMAIL_SEND_URL,
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json",
                        },
                        json={"raw": raw_message},
                        timeout=15.0,
                    )
                except httpx.RequestError as exc:
                    logger.error("Gmail API send network error: %s", type(exc).__name__)
                    raise EmailDeliveryError(
                        f"Network error sending via Gmail API: {type(exc).__name__}"
                    ) from exc

                if resp.status_code == 429:
                    logger.error(
                        "Gmail API quota exceeded (429) for recipient domain of %s",
                        to_email.split("@")[-1] if "@" in to_email else "<unknown>",
                    )
                    raise EmailDeliveryError(
                        "Gmail API quota exceeded. Retry after a cooldown period or switch email providers."
                    )

                if resp.status_code == 401:
                    logger.error("Gmail API 401: access token was rejected.")
                    raise EmailDeliveryError(
                        "Gmail API rejected the access token. The refresh token may have been revoked."
                    )

                if resp.status_code not in (200, 201, 202):
                    logger.error(
                        "Gmail API error: status=%d",
                        resp.status_code,
                    )
                    raise EmailDeliveryError(
                        f"Gmail API delivery failed with HTTP {resp.status_code}."
                    )

                logger.info("Gmail API successfully accepted email for %s", to_email)

        except EmailDeliveryError:
            raise
        except Exception as exc:
            logger.error("Unexpected Gmail API error: %s", type(exc).__name__)
            raise EmailDeliveryError(
                f"Unexpected error during Gmail API delivery: {type(exc).__name__}"
            ) from exc


def get_email_service() -> BaseEmailService:
    provider = str(settings.email_provider).lower().strip()
    if provider == "resend":
        return ResendEmailService(
            api_key=str(settings.resend_api_key),
            from_email=str(settings.email_from),
        )
    elif provider == "smtp":
        return SMTPEmailService(
            host=str(settings.smtp_host),
            port=int(settings.smtp_port),
            user=str(settings.smtp_user),
            password=str(settings.smtp_password),
            from_email=str(settings.email_from),
            use_tls=bool(settings.smtp_use_tls),
        )
    elif provider == "gmail_api":
        return GmailApiEmailService(
            client_id=str(settings.gmail_client_id),
            client_secret=str(settings.gmail_client_secret),
            refresh_token=str(settings.gmail_refresh_token),
            sender_email=str(settings.gmail_sender_email),
        )
    elif provider in ("simulated", "demo", "test"):
        return _simulated_service_instance
    else:
        raise ValueError(f"Unknown EMAIL_PROVIDER: {settings.email_provider}")


_simulated_service_instance = SimulatedEmailService()
