import json
import httpx
import pytest
from httpx import AsyncClient, Response

from app.core.config import settings
from app.models.user import User
from app.services.places import GooglePlacesService
from app.services.providers.gemma import GemmaQuestProvider


def httpx_mock_transport(handler):
    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            return await handler(request)

    return MockTransport()


# Mock Google Places Search Response
MOCK_PLACES_JSON = {
    "places": [
        {
            "id": "ChIJ_test_palace_fine_arts",
            "displayName": {"text": "Palace of Fine Arts", "languageCode": "en"},
            "location": {"latitude": 37.8020, "longitude": -122.4488},
            "primaryType": "tourist_attraction",
            "formattedAddress": "3301 Lyon St, San Francisco, CA 94123",
            "businessStatus": "OPERATIONAL",
        },
        {
            "id": "ChIJ_test_presidio_park",
            "displayName": {"text": "Presidio of San Francisco", "languageCode": "en"},
            "location": {"latitude": 37.7989, "longitude": -122.4662},
            "primaryType": "park",
            "formattedAddress": "San Francisco, CA 94129",
            "businessStatus": "OPERATIONAL",
        },
    ]
}

# Mock Gemma LLM structured response
MOCK_GEMMA_LLM_OUTPUT = {
    "selected_place_id": "ChIJ_test_palace_fine_arts",
    "title": "The Whispering Columns of the Rotunda",
    "story": "Ancient Greco-Roman echoes resonate through a tranquil lagoon, where an forgotten architectural relic harbors secret geometry.",
    "clues": [
        "Journey toward the waters near the northern bay where grand archways mirror across a peaceful pond.",
        "Seek the monumental ochre colonnade surrounded by weeping willows and wading birds.",
        "Stand beneath the central monumental rotunda where intricate allegorical friezes crown the dome.",
    ],
    "verification_prompt": "What mythical figure or relief is carved into the central frieze panel above the rotunda steps?",
    "verification_answer": "weeping women",
    "difficulty": "medium",
    "reward_xp": 300,
}


@pytest.mark.asyncio
async def test_google_places_service_search():
    # Test GooglePlacesService with mock transport
    async def handler(request):
        assert request.url == "https://places.googleapis.com/v1/places:searchNearby"
        assert "X-Goog-Api-Key" in request.headers
        assert "X-Goog-FieldMask" in request.headers
        body = json.loads(request.content)
        assert body["locationRestriction"]["circle"]["center"]["latitude"] == 37.7749
        return Response(200, json=MOCK_PLACES_JSON)

    mock_client = AsyncClient(transport=httpx_mock_transport(handler))

    service = GooglePlacesService(api_key="test_key", client=mock_client)
    places = await service.search_nearby_places(
        latitude=37.7749,
        longitude=-122.4194,
        radius_meters=5000.0,
    )

    assert len(places) == 2
    assert places[0].name == "Palace of Fine Arts"
    assert places[0].place_id == "ChIJ_test_palace_fine_arts"
    assert places[0].distance_meters is not None
    assert places[0].distance_meters > 0


@pytest.mark.asyncio
async def test_gemma_quest_provider_generation(test_user: User):
    # Mock Google Places client
    async def places_handler(request):
        return Response(200, json=MOCK_PLACES_JSON)

    # Mock Gemma LLM client
    async def gemma_handler(request):
        # OpenAI or Google format
        if "generateContent" in str(request.url):
            return Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"text": json.dumps(MOCK_GEMMA_LLM_OUTPUT)}]
                            }
                        }
                    ]
                },
            )
        else:
            return Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps(MOCK_GEMMA_LLM_OUTPUT)}}
                    ]
                },
            )

    places_client = AsyncClient(transport=httpx_mock_transport(places_handler))
    gemma_client = AsyncClient(transport=httpx_mock_transport(gemma_handler))

    places_service = GooglePlacesService(api_key="test_key", client=places_client)
    provider = GemmaQuestProvider(
        places_service=places_service,
        api_key="test_gemma_key",
        http_client=gemma_client,
    )

    from app.schemas.quest import QuestCreateRequest

    req = QuestCreateRequest(
        user_id=test_user.id,
        available_minutes=30,
        explorer_type="mystery",
        difficulty="medium",
        latitude=37.7749,
        longitude=-122.4194,
    )

    result = await provider.generate_quest(req)
    assert result.title == "The Whispering Columns of the Rotunda"
    assert result.destination_name == "Palace of Fine Arts"
    assert result.destination_latitude == 37.8020
    assert result.destination_longitude == -122.4488
    assert len(result.clues) == 3
    assert result.reward_xp == 300
    assert result.verification_prompt == "What mythical figure or relief is carved into the central frieze panel above the rotunda steps?"
    assert result.verification_answer == "weeping women"


@pytest.mark.asyncio
async def test_gemma_quest_provider_rejects_missing_coordinates(test_user: User):
    places_service = GooglePlacesService(api_key="test_key")
    provider = GemmaQuestProvider(places_service=places_service, api_key="test_gemma_key")

    from app.schemas.quest import QuestCreateRequest
    from app.services.providers.gemma import GemmaProviderError

    req = QuestCreateRequest(
        user_id=test_user.id,
        available_minutes=30,
        explorer_type="mystery",
        difficulty="medium",
        latitude=None,
        longitude=None,
    )

    with pytest.raises(GemmaProviderError, match="Latitude and longitude are required"):
        await provider.generate_quest(req)


@pytest.mark.asyncio
async def test_end_to_end_quest_generation_google_places_gemma(client: AsyncClient, test_user: User, monkeypatch):
    # Set provider to google_places_gemma
    monkeypatch.setattr(settings, "quest_provider", "google_places_gemma")
    monkeypatch.setattr(settings, "google_maps_api_key", "test_maps_key")
    monkeypatch.setattr(settings, "gemma_api_key", "test_gemma_key")

    import httpx
    original_post = httpx.AsyncClient.post

    async def mock_post(self, url, *args, **kwargs):
        if "places.googleapis.com" in str(url):
            return Response(200, json=MOCK_PLACES_JSON)
        if "generativelanguage.googleapis.com" in str(url) or "models/gemma" in str(url):
            return Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [{"text": json.dumps(MOCK_GEMMA_LLM_OUTPUT)}]
                            }
                        }
                    ]
                },
            )
        return await original_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    payload = {
        "user_id": str(test_user.id),
        "available_minutes": 30,
        "explorer_type": "mystery",
        "difficulty": "medium",
        "latitude": 37.7749,
        "longitude": -122.4194,
    }

    res = await client.post("/api/v1/quests/generate", json=payload)
    if res.status_code != 201:
        print("FAILED RESPONSE:", res.status_code, res.text)
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "draft"
    assert data["title"] == "The Whispering Columns of the Rotunda"
    assert data["reward_xp"] == 300
    # Must never expose real destination name before completion
    assert data["destination_name"] is None
    assert "destination_latitude" not in data
    assert "destination_longitude" not in data

    quest_id = data["id"]

    # Start quest -> first clue unlocked
    start_res = await client.post(f"/api/v1/quests/{quest_id}/start")
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert len(start_data["current_clues"]) == 1
    assert "Journey toward the waters" in start_data["current_clues"][0]["clue"]

    # Verify quest completion with coordinates and observation answer
    verify_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 37.8020,
            "longitude": -122.4488,
            "observation_answer": "weeping women",
        },
    )
    assert verify_res.status_code == 200
    v_data = verify_res.json()
    assert v_data["success"] is True
    assert v_data["reward_xp_awarded"] == 300
    assert v_data["quest"]["status"] == "completed"
    assert v_data["quest"]["destination_name"] == "Palace of Fine Arts"
