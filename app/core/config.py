from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "WAYBOUND API"
    app_version: str = "0.1.0"

    database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout: float = 30.0
    db_pool_recycle: int = 1800
    cors_origins: str = "*"
    verification_radius_meters: float = 100.0

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if not url:
            return ""
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    @property
    def cors_origins_list(self) -> list[str]:
        if not self.cors_origins:
            return ["*"] if self.environment != "production" else []
        origins: list[str] = []
        for o in self.cors_origins.split(","):
            raw = o.strip()
            if not raw:
                continue
            if raw == "*":
                if self.environment != "production":
                    origins.append("*")
                continue
            if not raw.startswith("http://") and not raw.startswith("https://"):
                is_local = raw.startswith("localhost") or raw.startswith("127.0.0.1")
                if is_local and self.environment != "production":
                    origins.append(f"http://{raw}")
                else:
                    origins.append(f"https://{raw}")
            else:
                origins.append(raw)
        return origins if origins else (["*"] if self.environment != "production" else [])

    # Provider mode: "demo" or "google_places_gemma"
    quest_provider: str = "demo"

    # Google Places API (New) Configuration
    google_maps_api_key: str = ""
    google_places_search_radius_meters: float = 5000.0
    google_places_min_radius_meters: float = 100.0
    google_places_max_radius_meters: float = 50000.0
    google_places_timeout_seconds: float = 10.0

    # Gemma AI Configuration
    gemma_api_key: str = ""
    gemma_model: str = "gemma-2-9b-it"
    gemma_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemma_timeout_seconds: float = 30.0
    gemma_max_retries: int = 3
    # Security and Session Configuration
    environment: str = "development"
    allow_demo_auth: bool = True
    auth_secret: str = "waybound_dev_insecure_auth_secret_must_change_in_production"
    session_token_expire_days: int = 30
    party_invite_expire_hours: int = 48
    otp_expire_minutes: int = 10
    otp_max_attempts: int = 5
    auth_rate_limit_per_minute: int = 10

    # Transactional Email Provider Configuration
    # Options: "simulated" (development/test only), "resend", "smtp", "gmail_api"
    email_provider: str = "simulated"
    email_from: str = "WAYBOUND <auth@waybound.dev>"
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True

    # Gmail API OAuth2 Configuration (used only when EMAIL_PROVIDER=gmail_api)
    # Never commit these values; supply exclusively via environment variables or secrets manager.
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_refresh_token: str = ""
    gmail_sender_email: str = ""

    # Multi-worker Rate Limiter Storage: "memory" or "database"
    rate_limit_storage: str = "database"

    # Trusted Proxies for X-Forwarded-For evaluation (comma-separated IPs/CIDRs, or empty to only trust direct connection)
    # Example: "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    trusted_proxies: str = "127.0.0.1,::1"

    # ElevenLabs Text-to-Speech Configuration
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"  # Default: Rachel (warm storyteller)
    elevenlabs_model_id: str = "eleven_turbo_v2_5"      # Low-latency, credit-efficient
    elevenlabs_enabled: bool = False
    elevenlabs_timeout_seconds: float = 15.0
    elevenlabs_rate_limit_per_minute: int = 20
    elevenlabs_user_daily_limit: int = 50
    elevenlabs_global_daily_limit: int = 200
    narration_cache_max_items: int = 500
    elevenlabs_allowed_voice_ids: str = "21m00Tcm4TlvDq8ikWAM,AZnzlk1XvdvUeBnXmlld,EXAVITQu4vr4xnSDxMaL,ErXwobaYiN019PkySvjV,MF3mGyEYCl7XYWbV9V6O,TxGEqnHWrfWFTfGW9XjX,VR6AewLTigWG4xSOukaG,pNInz6obpgDQGcFmaJgB,yoZ06aMxZJJ28mfd3POQ"
    elevenlabs_allowed_model_ids: str = "eleven_multilingual_v2,eleven_turbo_v2_5,eleven_turbo_v2,eleven_monolingual_v1"


    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.environment == "production":
            self.allow_demo_auth = False
            insecure_placeholders = [
                "waybound_dev_insecure_auth_secret_must_change_in_production",
                "dev_secret_waybound_session_key_change_in_production",
                "secret",
                "changeme",
                "change_me",
                "password",
            ]
            if (
                not self.auth_secret
                or len(self.auth_secret.strip()) < 32
                or self.auth_secret.strip() in insecure_placeholders
            ):
                raise ValueError(
                    "Production configuration error: Insecure or missing AUTH_SECRET. A strong, cryptographically random secret with at least 32 characters is required in production."
                )

            # In production, simulated email provider is strictly forbidden
            if self.email_provider.lower().strip() in ("simulated", "demo", "test"):
                raise ValueError(
                    "Production configuration error: EMAIL_PROVIDER cannot be 'simulated' in production. Configure 'resend', 'smtp', or 'gmail_api' with valid credentials."
                )


            if self.email_provider.lower().strip() == "resend" and not self.resend_api_key:
                raise ValueError(
                    "Production configuration error: RESEND_API_KEY must be provided when EMAIL_PROVIDER is 'resend'."
                )

            if self.email_provider.lower().strip() == "smtp" and not self.smtp_host:
                raise ValueError(
                    "Production configuration error: SMTP_HOST must be provided when EMAIL_PROVIDER is 'smtp'."
                )

            if self.email_provider.lower().strip() == "gmail_api":
                missing: list[str] = []
                if not self.gmail_client_id:
                    missing.append("GMAIL_CLIENT_ID")
                if not self.gmail_client_secret:
                    missing.append("GMAIL_CLIENT_SECRET")
                if not self.gmail_refresh_token:
                    missing.append("GMAIL_REFRESH_TOKEN")
                if not self.gmail_sender_email:
                    missing.append("GMAIL_SENDER_EMAIL")
                if missing:
                    raise ValueError(
                        (
                            "Production configuration error: The following variables are required when "
                            f"EMAIL_PROVIDER is 'gmail_api': {', '.join(missing)}."
                        )
                    )

            # In production, CORS_ORIGINS cannot be wildcard or empty; must be explicit HTTPS allowlist
            raw_cors = self.cors_origins.strip()
            if not raw_cors or raw_cors == "*" or not self.cors_origins_list or "*" in self.cors_origins_list:
                raise ValueError(
                    "Production configuration error: CORS_ORIGINS cannot be '*' or empty in production. Configure an explicit allowlist of HTTPS frontend origins (e.g. 'https://waybound-frontend.onrender.com')."
                )

            for origin in self.cors_origins_list:
                if not origin.startswith("https://"):
                    raise ValueError(
                        f"Production configuration error: CORS origin '{origin}' must use the secure HTTPS protocol."
                    )
                domain_part = origin[len("https://"):].split("/")[0].split(":")[0]
                if "." not in domain_part:
                    raise ValueError(
                        f"Production configuration error: CORS origin '{origin}' must be an actual public domain with a valid TLD (e.g. 'https://waybound-frontend.onrender.com'), not an internal hostname."
                    )

            # In production, unverified or placeholder sender email is strictly forbidden
            placeholder_senders = [
                "waybound <auth@waybound.dev>",
                "auth@waybound.dev",
                "example.com",
                "test@example.com",
                "placeholder",
            ]
            cleaned_from = self.email_from.strip().lower()
            if not self.email_from or any(p in cleaned_from for p in placeholder_senders):
                raise ValueError(
                    "Production configuration error: Insecure or unverified EMAIL_FROM address. You must configure an explicit verified sending address for your domain (e.g. 'WAYBOUND <auth@yourdomain.com>') or Resend's verified sandbox address 'onboarding@resend.dev' before deploying."
                )
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()