from functools import lru_cache

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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()