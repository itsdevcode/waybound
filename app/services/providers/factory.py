import logging

from app.core.config import settings
from app.services.places import GooglePlacesService
from app.services.providers.base import QuestProvider
from app.services.providers.demo import DemoQuestProvider
from app.services.providers.gemma import GemmaQuestProvider

logger = logging.getLogger(__name__)


def create_quest_provider(mode: str | None = None) -> QuestProvider:
    """
    Factory creating the configured QuestProvider.
    Explicit modes:
    - 'demo': Simulated quest provider (deterministic public mock destinations).
    - 'google_places_gemma': Real location discovery via Google Places API (New) and Gemma AI narrative generation.

    Never silently falls back to simulated quests if 'google_places_gemma' is configured.
    """
    provider_mode = mode or settings.quest_provider

    if provider_mode == "demo":
        logger.info("Initializing QuestProvider in 'demo' simulated mode")
        return DemoQuestProvider()

    if provider_mode == "google_places_gemma":
        logger.info("Initializing QuestProvider in 'google_places_gemma' AI Game Master mode")
        if not settings.google_maps_api_key:
            raise ValueError(
                "GOOGLE_MAPS_API_KEY must be configured when quest_provider is set to 'google_places_gemma'."
            )
        places_service = GooglePlacesService()
        return GemmaQuestProvider(places_service=places_service)

    raise ValueError(
        f"Unsupported quest_provider mode: '{provider_mode}'. Supported modes are 'demo' and 'google_places_gemma'."
    )
