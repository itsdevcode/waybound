import json
import logging
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.schemas.place import PlaceCandidate
from app.schemas.quest import QuestCreateRequest
from app.services.places import GooglePlacesService
from app.services.providers.base import QuestGenerationResult, QuestProvider

logger = logging.getLogger(__name__)


class GemmaQuestStructuredOutput(BaseModel):
    selected_place_id: str = Field(..., description="The place_id of the selected candidate")
    title: str = Field(..., max_length=150, description="RPG-style quest title")
    story: str = Field(..., description="Immersive adventure backstory and atmosphere")
    clues: list[str] = Field(
        ...,
        min_length=3,
        max_length=3,
        description="Exactly three progressive mystery clues. Early clues must not reveal destination name.",
    )
    verification_prompt: str = Field(
        ...,
        description="Observation verification challenge about physical details verified at the destination",
    )
    verification_answer: str = Field(
        ...,
        description="Short, unambiguous answer to verification challenge",
    )
    difficulty: str = Field(default="medium", description="Quest difficulty: easy, medium, hard")
    reward_xp: int = Field(default=250, ge=50, le=1000, description="XP reward for completion")


class GemmaProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class GemmaQuestProvider(QuestProvider):
    """
    AI Game Master quest provider using Gemma and real Google Places candidates.
    Never hallucinates coordinates or destinations: chooses strictly from provided real candidates.
    """

    def __init__(
        self,
        places_service: GooglePlacesService,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.places_service = places_service
        self.api_key = api_key or settings.gemma_api_key or settings.google_maps_api_key
        self.model = model or settings.gemma_model
        self.base_url = (base_url or settings.gemma_base_url).rstrip("/")
        self.timeout_seconds = timeout_seconds or settings.gemma_timeout_seconds
        self.max_retries = max_retries or settings.gemma_max_retries
        self.http_client = http_client

    def _build_prompt(
        self,
        request: QuestCreateRequest,
        candidates: list[PlaceCandidate],
    ) -> str:
        candidate_list_text = "\n".join([
            f"- place_id: \"{c.place_id}\", name: \"{c.name}\", type: \"{c.primary_type}\", address: \"{c.address or 'N/A'}\", distance: {c.distance_meters or 0}m"
            for c in candidates
        ])

        return f"""You are the AI Game Master for WAYBOUND, an exploration platform turning real-world places into mystery quests.

An explorer has requested a quest:
- Explorer archetype: {request.explorer_type}
- Difficulty: {request.difficulty}
- Duration: {request.available_minutes} minutes

Here are real nearby candidate locations discovered via Google Places:
{candidate_list_text}

TASK INSTRUCTIONS:
1. Select EXACTLY ONE location from the candidate list by its `place_id`. You MUST NOT invent any place or place_id.
2. Generate an RPG-style quest title (maximum 150 characters).
3. Create an immersive story (backstory and atmosphere matching the explorer archetype).
4. Provide EXACTLY THREE progressive clues:
   - Clue 1: Atmospheric directional riddle pointing toward the general area. MUST NOT reveal the destination name.
   - Clue 2: Distinctive architectural or natural landmark hint near the target. MUST NOT reveal the destination name.
   - Clue 3: Detailed environmental clue that guides the explorer right to the specific spot.
5. Create a verification prompt and concise verification answer:
   - Challenge the explorer to observe a prominent physical feature at this public landmark (e.g., color of plaque, type of tree/statue, architectural style, inscription date, fountain motif).
   - The verification answer must be short and direct (1-3 words).
6. Set appropriate difficulty ("easy", "medium", or "hard") and reward XP (100 to 500).

Return ONLY a valid JSON object with this exact structure:
{{
  "selected_place_id": "<place_id from candidate list>",
  "title": "<RPG quest title>",
  "story": "<immersive backstory>",
  "clues": [
    "<Clue 1 riddle without revealing place name>",
    "<Clue 2 landmark hint without revealing place name>",
    "<Clue 3 close environmental detail>"
  ],
  "verification_prompt": "<Question asking what feature is visible at the site>",
  "verification_answer": "<concise expected observation>",
  "difficulty": "{request.difficulty}",
  "reward_xp": 250
}}
"""

    def _clean_and_parse_json(self, raw_text: str) -> dict[str, Any]:
        """Extracts JSON substring from LLM response and parses it."""
        cleaned = raw_text.strip()
        # Remove markdown codeblocks if present
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE)

        # Find the first { and last }
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1:
            cleaned = cleaned[start : end + 1]

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.error("Failed to decode JSON from Gemma output: %s", type(e).__name__)
            raise GemmaProviderError(
                "Gemma model returned invalid JSON structure", status_code=502
            )

    async def _call_gemma_api(self, prompt: str) -> str:
        """Calls Gemma API with retries and timeout."""
        # Check API key
        if not self.api_key:
            raise GemmaProviderError(
                "Gemma API key is not configured. Set GEMMA_API_KEY in configuration.",
                status_code=500,
            )

        # Standard OpenAI-compatible / Google REST compatible payload format
        # If base_url contains "generativelanguage.googleapis.com", use Gemini/Gemma format
        is_google_api = "generativelanguage.googleapis.com" in self.base_url

        if is_google_api:
            # Query parameter authentication for Google Generative Language
            url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024},
            }
            headers = {"Content-Type": "application/json"}
        else:
            # OpenAI / vLLM / Ollama compatible chat completions endpoint
            url = f"{self.base_url}/chat/completions"
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
            }
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            }

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                if self.http_client:
                    response = await self.http_client.post(
                        url, json=payload, headers=headers, timeout=self.timeout_seconds
                    )
                else:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            url, json=payload, headers=headers, timeout=self.timeout_seconds
                        )

                if response.status_code != 200:
                    logger.warning(
                        "Gemma API attempt %d returned HTTP error status %d",
                        attempt,
                        response.status_code,
                    )
                    if response.status_code in (401, 403):
                        raise GemmaProviderError(
                            "Gemma API authentication failed",
                            status_code=502,
                        )
                    if response.status_code >= 500 or response.status_code == 429:
                        continue  # retry on transient server or rate limit errors
                    raise GemmaProviderError(
                        f"Gemma API call failed with status {response.status_code}",
                        status_code=502,
                    )

                data = response.json()
                if is_google_api:
                    candidates = data.get("candidates", [])
                    if not candidates:
                        raise GemmaProviderError("Gemma API returned no candidates", status_code=502)
                    content_parts = candidates[0].get("content", {}).get("parts", [])
                    if not content_parts:
                        raise GemmaProviderError("Gemma API returned empty text part", status_code=502)
                    return content_parts[0].get("text", "")
                else:
                    choices = data.get("choices", [])
                    if not choices:
                        raise GemmaProviderError("Gemma API returned no choices", status_code=502)
                    return choices[0].get("message", {}).get("content", "")

            except (httpx.TimeoutException, httpx.RequestError) as e:
                logger.warning("Gemma API attempt %d connection error: %s", attempt, type(e).__name__)
                last_error = e

        raise GemmaProviderError(
            f"Gemma API request failed after {self.max_retries} attempts",
            status_code=504,
        )

    async def generate_quest(
        self,
        request: QuestCreateRequest,
    ) -> QuestGenerationResult:
        # Latitude and longitude are required for real location discovery
        if request.latitude is None or request.longitude is None:
            raise GemmaProviderError(
                "Latitude and longitude are required for real location discovery in google_places_gemma mode.",
                status_code=400,
            )

        # Step 2 & 3: Discover real Google Places candidates
        candidates = await self.places_service.search_nearby_places(
            latitude=request.latitude,
            longitude=request.longitude,
            radius_meters=settings.google_places_search_radius_meters,
        )

        if not candidates:
            raise GemmaProviderError(
                "No suitable public exploration locations found nearby. Try expanding the search radius or choosing a different starting point.",
                status_code=404,
            )

        # Build prompt with candidates and generate narrative with Gemma
        prompt = self._build_prompt(request, candidates)
        raw_text = await self._call_gemma_api(prompt)
        parsed_data = self._clean_and_parse_json(raw_text)

        # Validate with Pydantic
        try:
            structured = GemmaQuestStructuredOutput.model_validate(parsed_data)
        except ValidationError as e:
            logger.error("Pydantic validation failed for Gemma output: %s", type(e).__name__)
            raise GemmaProviderError(
                "Gemma generated invalid quest structure", status_code=502
            )

        # Verify selected place_id exists in our real candidate list (Anti-Hallucination Guard)
        # NEVER silently substitute another destination if the LLM hallucinated an unknown place ID!
        place_map = {c.place_id: c for c in candidates}
        selected_candidate = place_map.get(structured.selected_place_id)

        if not selected_candidate:
            logger.error(
                "Gemma selected place_id '%s' which was not in candidate list of %d places",
                structured.selected_place_id,
                len(candidates),
            )
            raise GemmaProviderError(
                f"Gemma selected an unknown place_id '{structured.selected_place_id}' not found in discovered candidates",
                status_code=502,
            )

        # Guard: Check that early clues (Clue 1 and Clue 2) do not reveal the destination name
        dest_name_words = [
            w.lower()
            for w in re.findall(r"\b[A-Za-z]{4,}\b", selected_candidate.name)
            if w.lower() not in ("park", "museum", "center", "plaza", "monument", "historic")
        ]
        for idx in range(min(2, len(structured.clues))):
            clue_lower = structured.clues[idx].lower()
            for word in dest_name_words:
                if word in clue_lower:
                    logger.info("Sanitizing destination keyword '%s' from early clue %d", word, idx + 1)
                    structured.clues[idx] = re.sub(
                        re.escape(word), "the hidden site", structured.clues[idx], flags=re.IGNORECASE
                    )

        return QuestGenerationResult(
            title=structured.title[:150],
            description=structured.story,
            difficulty=request.difficulty,
            estimated_minutes=request.available_minutes,
            reward_xp=structured.reward_xp,
            destination_name=selected_candidate.name,
            destination_latitude=selected_candidate.latitude,
            destination_longitude=selected_candidate.longitude,
            verification_prompt=structured.verification_prompt,
            verification_answer=structured.verification_answer,
            clues=structured.clues[:3],
        )
