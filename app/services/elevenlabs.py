import hashlib
import logging
from collections import OrderedDict
from threading import Lock

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class ElevenLabsError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NarrationCache:
    """
    In-memory LRU audio cache for synthesized narration MP3 bytes.
    Reduces ElevenLabs character quota consumption by reusing previously generated audio.
    Key structure: SHA-256 of voice_id + model_id + content_text + authorization_scope.
    """

    def __init__(self, max_items: int = 500) -> None:
        self.max_items = max_items
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._lock = Lock()

    @staticmethod
    def build_cache_key(voice_id: str, model_id: str, text: str, scope: str = "") -> str:
        raw = f"{voice_id}::{model_id}::{scope}::{text.strip()}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def get(self, key: str) -> bytes | None:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
            return None

    def put(self, key: str, audio_bytes: bytes) -> None:
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                self._cache[key] = audio_bytes
                return
            if len(self._cache) >= self.max_items:
                _ = self._cache.popitem(last=False)
            self._cache[key] = audio_bytes

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


# Global cache instance
narration_cache = NarrationCache(max_items=settings.narration_cache_max_items)


class ElevenLabsService:
    """
    Server-side integration with ElevenLabs Text-to-Speech API.
    Guarantees:
    1. Keeps ELEVENLABS_API_KEY strictly server-side.
    2. Caches audio to save credits.
    3. Handles timeouts, network errors, and quota limits gracefully.
    """

    def __init__(
        self,
        api_key: str | None = None,
        default_voice_id: str | None = None,
        default_model_id: str | None = None,
        timeout_seconds: float | None = None,
        cache: NarrationCache | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.elevenlabs_api_key
        self.default_voice_id = default_voice_id or settings.elevenlabs_voice_id
        self.default_model_id = default_model_id or settings.elevenlabs_model_id
        self.timeout_seconds = timeout_seconds or settings.elevenlabs_timeout_seconds
        self.cache = cache or narration_cache
        self.base_url = "https://api.elevenlabs.io/v1"

    def is_configured(self) -> bool:
        return bool(settings.elevenlabs_enabled and self.api_key)

    async def generate_speech(
        self,
        text: str,
        voice_id: str | None = None,
        model_id: str | None = None,
        auth_scope: str = "",
    ) -> bytes:
        if not self.is_configured():
            raise ElevenLabsError(
                "ElevenLabs narration is currently disabled or unconfigured on the server.",
                status_code=503,
            )

        cleaned_text = text.strip()
        if not cleaned_text:
            raise ElevenLabsError("Narration text cannot be empty.", status_code=400)

        # Enforce input length limits to avoid quota abuse
        if len(cleaned_text) > 2000:
            raise ElevenLabsError("Narration text exceeds 2000 character limit.", status_code=400)

        selected_voice = (voice_id or self.default_voice_id).strip()
        selected_model = (model_id or self.default_model_id).strip()

        # Check cache
        cache_key = self.cache.build_cache_key(
            voice_id=selected_voice,
            model_id=selected_model,
            text=cleaned_text,
            scope=auth_scope,
        )
        cached_audio = self.cache.get(cache_key)
        if cached_audio:
            logger.info("Serving narration from cache for key %s", cache_key[:12])
            return cached_audio

        endpoint = f"{self.base_url}/text-to-speech/{selected_voice}"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload: dict[str, object] = {
            "text": cleaned_text,
            "model_id": selected_model,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                resp = await client.post(endpoint, json=payload, headers=headers)

                if resp.status_code == 401:
                    logger.error("ElevenLabs authentication failed: invalid API key.")
                    raise ElevenLabsError(
                        "ElevenLabs authentication error. Please check server API key.",
                        status_code=502,
                    )
                if resp.status_code == 429:
                    logger.warning("ElevenLabs quota exceeded or rate limited.")
                    raise ElevenLabsError(
                        "ElevenLabs quota limit reached. Falling back to browser speech.",
                        status_code=429,
                    )
                if resp.status_code not in (200, 201):
                    logger.error(
                        "ElevenLabs API error: status=%d response=%s",
                        resp.status_code,
                        resp.text[:200],
                    )
                    raise ElevenLabsError(
                        f"ElevenLabs TTS generation failed (status {resp.status_code}).",
                        status_code=502,
                    )

                audio_bytes = resp.content
                if not audio_bytes:
                    raise ElevenLabsError("ElevenLabs returned empty audio data.", status_code=502)

                # Store in cache
                self.cache.put(cache_key, audio_bytes)
                logger.info(
                    "Generated and cached ElevenLabs audio (%d bytes) for voice %s",
                    len(audio_bytes),
                    selected_voice,
                )
                return audio_bytes

        except httpx.TimeoutException as exc:
            logger.error("ElevenLabs request timed out: %s", exc)
            raise ElevenLabsError(
                "ElevenLabs request timed out. Please retry or use browser voice.",
                status_code=504,
            ) from exc
        except httpx.RequestError as exc:
            logger.error("Network error communicating with ElevenLabs: %s", exc)
            raise ElevenLabsError(
                f"Failed to communicate with ElevenLabs: {exc}",
                status_code=502,
            ) from exc


elevenlabs_service = ElevenLabsService()
