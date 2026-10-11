import json
import logging
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.core.geo import calculate_haversine_distance_meters
from app.schemas.place import PlaceCandidate
from app.schemas.quest import QuestCreateRequest
from app.services.places import GooglePlacesService
from app.services.providers.base import (
    QuestGenerationResult,
    QuestProvider,
    StepWaypointCandidate,
)

logger = logging.getLogger(__name__)

LANDMARK_SYNONYMS: dict[str, set[str]] = {
    "steps": {"stairs", "steps", "stairway", "staircase", "terrace", "climb", "flights"},
    "stairs": {"stairs", "steps", "stairway", "staircase", "climb", "flights"},
    "bridge": {"bridge", "crossing", "overpass", "span", "arch", "trestle", "viaduct"},
    "arch": {"arch", "arched", "gateway", "portal", "span", "arc"},
    "rotunda": {"rotunda", "dome", "cupola", "pavilion", "columns", "colonnade"},
    "dome": {"rotunda", "dome", "cupola", "vault"},
    "tower": {"tower", "spire", "column", "belfry", "minaret", "needle", "pinnacle"},
    "monument": {"monument", "memorial", "pillar", "obelisk", "cenotaph", "shrine"},
    "statue": {"statue", "sculpture", "figure", "bronze", "marble", "monument", "bust"},
    "fountain": {"fountain", "basin", "water", "cascade", "pool", "spout", "geyser"},
    "garden": {"garden", "botanical", "flora", "greenery", "grove", "arboretum", "plants"},
    "park": {"park", "meadow", "lawn", "grounds", "plaza", "square", "preserve"},
    "plaza": {"plaza", "square", "courtyard", "piazza", "esplanade"},
    "pier": {"pier", "dock", "wharf", "marina", "waterfront", "quay", "jetty"},
    "lagoon": {"lagoon", "lake", "pond", "water", "pool", "basin", "reservoir"},
    "lake": {"lake", "lagoon", "pond", "water", "reservoir"},
    "pond": {"pond", "lake", "lagoon", "water", "pool"},
    "library": {"library", "books", "manuscripts", "archives", "reading"},
    "museum": {"museum", "gallery", "exhibit", "collection", "artifacts"},
    "hall": {"hall", "auditorium", "theater", "theatre", "pavilion"},
    "church": {"church", "chapel", "cathedral", "sanctuary", "temple", "shrine", "basilica"},
    "basilica": {"basilica", "church", "cathedral", "sanctuary"},
    "temple": {"temple", "shrine", "sanctuary", "pagoda"},
    "fort": {"fort", "fortress", "citadel", "bastion", "battery", "rampart"},
    "overlook": {"overlook", "vista", "viewpoint", "view", "lookout", "panorama"},
    "viewpoint": {"overlook", "vista", "viewpoint", "view", "lookout"},
    "trail": {"path", "trail", "walkway", "promenade", "lane", "route"},
    "path": {"path", "trail", "walkway", "promenade", "lane"},
}

INACCESSIBLE_TYPES: set[str] = {
    "private_residence",
    "corporate_office",
    "car_repair",
    "parking",
    "gas_station",
    "storage",
    "car_dealer",
}

STOP_WORDS: set[str] = {
    "the", "and", "of", "in", "at", "for", "to", "a", "an", "on", "by", "with",
    "st", "ave", "rd", "dr", "blvd", "street", "avenue", "boulevard",
    "drive", "road", "place", "suite", "floor", "way", "lane", "san",
    "francisco", "california", "city", "state", "center", "centre", "building",
}


def is_publicly_accessible(candidate: PlaceCandidate) -> bool:
    """Verifies that a candidate location is publicly accessible and operational."""
    if candidate.business_status and candidate.business_status in (
        "CLOSED_PERMANENTLY",
        "CLOSED_TEMPORARILY",
    ):
        return False
    if candidate.primary_type and candidate.primary_type in INACCESSIBLE_TYPES:
        return False
    return True


def semantically_matches_clue(clue: str, candidate: PlaceCandidate) -> bool:
    """
    Validates that a waypoint candidate semantically matches the corresponding clue text.
    Checks direct significant tokens and landmark synonyms against the clue narrative.
    """
    clue_lower = clue.lower()

    # 1. Significant tokens from candidate name
    name_tokens = [
        t.lower()
        for t in re.findall(r"\b[A-Za-z0-9]{3,}\b", candidate.name)
        if t.lower() not in STOP_WORDS
    ]

    for token in name_tokens:
        if token in clue_lower:
            return True
        synonyms = LANDMARK_SYNONYMS.get(token, set())
        if any(syn in clue_lower for syn in synonyms):
            return True

    # 2. Significant tokens from candidate primary_type
    type_tokens = [
        t.lower()
        for t in re.findall(r"\b[A-Za-z0-9]{3,}\b", candidate.primary_type)
        if t.lower() not in STOP_WORDS
    ]
    for token in type_tokens:
        if token in clue_lower:
            return True
        synonyms = LANDMARK_SYNONYMS.get(token, set())
        if any(syn in clue_lower for syn in synonyms):
            return True

    return False


class GemmaQuestStructuredOutput(BaseModel):
    selected_place_id: str = Field(..., description="The place_id of the selected final destination candidate")
    intermediate_waypoint_place_ids: list[str | None] = Field(
        default_factory=list,
        description="Optional list of place_ids from the candidate list to serve as intermediate clue waypoints. Max 2.",
    )
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
1. Select EXACTLY ONE location from the candidate list by its `place_id` as the final secret destination (`selected_place_id`). You MUST NOT invent any place or place_id.
2. Intermediate Waypoints (Optional):
   - You may optionally select up to 2 distinct intermediate waypoint place_ids from the candidate list (`intermediate_waypoint_place_ids`) to associate with Clue 1 and/or Clue 2.
   - Do NOT select the final destination as an intermediate waypoint.
   - Each selected intermediate waypoint MUST be publicly accessible and reasonably ordered along the exploration journey from the explorer towards the destination.
   - CRITICAL REQUIREMENT: If you select an intermediate waypoint for Clue 1 or Clue 2, that clue's text MUST semantically describe distinctive physical, architectural, or environmental features of that specific waypoint location (without revealing its exact full proper name).
   - If no candidate has features matching your narrative or candidates are unsuitable, do NOT select any intermediate waypoints; pass an empty list `[]`.
3. Generate an RPG-style quest title (maximum 150 characters).
4. Create an immersive story (backstory and atmosphere matching the explorer archetype).
5. Provide EXACTLY THREE progressive clues:
   - Clue 1: Atmospheric directional riddle pointing toward the first waypoint or area. MUST NOT reveal the destination name.
   - Clue 2: Distinctive architectural or natural landmark hint near the target or intermediate waypoint. MUST NOT reveal the destination name.
   - Clue 3: Detailed environmental clue that guides the explorer right to the specific destination spot.
6. Create a verification prompt and concise verification answer:
   - Challenge the explorer to observe a prominent physical feature at the final destination (e.g., color of plaque, type of tree/statue, architectural style, inscription date, fountain motif).
   - The verification answer must be short and direct (1-3 words).
7. Set appropriate difficulty ("easy", "medium", or "hard") and reward XP (100 to 500).

Return ONLY a valid JSON object with this exact structure:
{{
  "selected_place_id": "<place_id of destination from candidate list>",
  "intermediate_waypoint_place_ids": ["<place_id from candidate list>", "<optional second place_id>"],
  "title": "<RPG quest title>",
  "story": "<immersive backstory>",
  "clues": [
    "<Clue 1 riddle without revealing destination name>",
    "<Clue 2 landmark hint without revealing destination name>",
    "<Clue 3 close environmental detail>"
  ],
  "verification_prompt": "<Question asking what feature is visible at destination>",
  "verification_answer": "<concise expected observation>",
  "difficulty": "{request.difficulty}",
  "reward_xp": 250
}}
"""

    def _clean_and_parse_json(self, raw_text: str) -> dict[str, Any]:
        """Extracts JSON substring from LLM response and parses it."""
        cleaned = raw_text.strip()
        # Remove markdown codeblocks if present
        if "```" in cleaned:
            # Match ```json ... ``` or ``` ... ```
            codeblock_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
            if codeblock_match:
                cleaned = codeblock_match.group(1).strip()
            else:
                cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.MULTILINE)
                cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE)

        # Find the first { and last }
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]

        # First attempt: standard json.loads
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Second attempt: handle common LLM JSON syntax issues (trailing commas, unescaped newlines)
        try:
            # Remove trailing commas before closing braces/brackets
            fixed = re.sub(r",\s*([\]}])", r"\1", cleaned)
            return json.loads(fixed)
        except json.JSONDecodeError as e:
            snippet = raw_text[:300].replace("\n", " ")
            logger.error(
                "Failed to decode JSON from Gemma output: %s. Snippet: %r",
                type(e).__name__,
                snippet,
            )
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
                "generationConfig": {
                    "temperature": 0.4,
                    "maxOutputTokens": 2048,
                    "responseMimeType": "application/json",
                },
            }
            headers = {"Content-Type": "application/json"}
        else:
            # OpenAI / vLLM / Ollama compatible chat completions endpoint
            url = f"{self.base_url}/chat/completions"
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
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

        # Attempt generation and parsing with retry on JSON / structure errors
        structured: GemmaQuestStructuredOutput | None = None
        last_parse_err: Exception | None = None

        for parse_attempt in range(1, 3):
            raw_text = await self._call_gemma_api(prompt)
            try:
                parsed_data = self._clean_and_parse_json(raw_text)
                structured = GemmaQuestStructuredOutput.model_validate(parsed_data)
                break
            except (GemmaProviderError, ValidationError) as e:
                last_parse_err = e
                logger.warning("Gemma output parse/validation attempt %d failed: %s", parse_attempt, e)
                continue

        if structured is None:
            if isinstance(last_parse_err, GemmaProviderError):
                raise last_parse_err
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

        # Validate and associate intermediate waypoints with clues
        # Strictly enforce:
        # 1. Validated against Google Places candidates (excluding the secret destination).
        # 2. Distinct from each other and the destination.
        # 3. Publicly accessible and operational.
        # 4. Semantically matches the corresponding clue.
        # 5. Reasonably ordered along the exploration journey (no severe backtracking).
        # 6. NEVER fallback to auto-assigning arbitrary nearest places if AI returns none or unsuitable candidates.
        other_candidates = [
            c for c in candidates if c.place_id != selected_candidate.place_id
        ]
        other_by_id = {c.place_id: c for c in other_candidates}

        step_waypoints: list[StepWaypointCandidate | None] = [None, None, None]
        seen_place_ids: set[str] = set()

        start_lat = request.latitude
        start_lon = request.longitude

        raw_waypoint_ids = structured.intermediate_waypoint_place_ids or []
        for idx in range(min(2, len(raw_waypoint_ids))):
            wp_id = raw_waypoint_ids[idx]
            if not wp_id or wp_id not in other_by_id:
                continue

            cand = other_by_id[wp_id]

            # 1. Distinctness
            if cand.place_id in seen_place_ids:
                logger.info("Intermediate waypoint '%s' already used; skipping duplicate.", cand.name)
                continue

            # 2. Public Accessibility
            if not is_publicly_accessible(cand):
                logger.info("Intermediate waypoint '%s' is not publicly accessible; omitting.", cand.name)
                continue

            # 3. Semantic match with corresponding clue
            clue_text = structured.clues[idx] if idx < len(structured.clues) else ""
            if not semantically_matches_clue(clue_text, cand):
                logger.info(
                    "Intermediate waypoint '%s' does not semantically match Clue %d ('%s'); omitting.",
                    cand.name,
                    idx + 1,
                    clue_text[:60],
                )
                continue

            # 4. Reasonably ordered along the exploration journey
            cand_dist = calculate_haversine_distance_meters(
                start_lat, start_lon, cand.latitude, cand.longitude
            )
            # If this is waypoint 2 (idx == 1) and waypoint 1 was accepted:
            if idx == 1 and step_waypoints[0] is not None and step_waypoints[0].place_id:
                wp1_cand = other_by_id.get(step_waypoints[0].place_id)
                if wp1_cand:
                    wp1_dist = calculate_haversine_distance_meters(
                        start_lat, start_lon, wp1_cand.latitude, wp1_cand.longitude
                    )
                    # Waypoint 2 should not cause severe backtracking compared to Waypoint 1
                    if cand_dist < wp1_dist - 200:
                        logger.info(
                            "Waypoint 2 ('%s', %.0fm) is out of journey order compared to Waypoint 1 ('%s', %.0fm); omitting.",
                            cand.name,
                            cand_dist,
                            wp1_cand.name,
                            wp1_dist,
                        )
                        continue

            seen_place_ids.add(cand.place_id)
            step_waypoints[idx] = StepWaypointCandidate(
                place_id=cand.place_id,
                name=cand.name,
                latitude=cand.latitude,
                longitude=cand.longitude,
            )

        while step_waypoints and step_waypoints[-1] is None:
            _ = step_waypoints.pop()

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
            waypoints=step_waypoints,
        )
