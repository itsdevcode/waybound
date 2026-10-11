import abc
import asyncio
import email.message
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
    elif provider in ("simulated", "demo", "test"):
        return _simulated_service_instance
    else:
        raise ValueError(f"Unknown EMAIL_PROVIDER: {settings.email_provider}")


_simulated_service_instance = SimulatedEmailService()
