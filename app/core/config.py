from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "WAYBOUND API"
    app_version: str = "0.1.0"

    database_url: str = ""
    verification_radius_meters: float = 100.0

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