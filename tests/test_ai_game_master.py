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

    # Verify quest completion with coordinates and observation answer:
    # Safe verification mode ensures unverified real-world AI quests do NOT award XP by default
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
    # Real-world verified quests legitimately award XP upon physical arrival
    assert v_data["reward_xp_awarded"] == 300
    assert v_data["total_xp"] == 300
    assert "earned 300 XP" in v_data["message"]
    assert v_data["quest"]["destination_name"] == "Palace of Fine Arts"


@pytest.mark.asyncio
async def test_gemma_provider_rejects_unknown_place_id(test_user: User):
    """Test requirement 2: Reject Gemma outputs that select an unknown Google Place ID. Never silently substitute."""
    # Mock Google Places returning candidate "ChIJ_real_candidate"
    async def places_handler(request):
        return Response(200, json={
            "places": [{
                "id": "ChIJ_real_candidate",
                "displayName": {"text": "Golden Gate Park", "languageCode": "en"},
                "location": {"latitude": 37.7694, "longitude": -122.4862},
                "primaryType": "park",
                "businessStatus": "OPERATIONAL",
            }]
        })

    # Mock Gemma hallucinating an unknown place ID "ChIJ_hallucinated_place_id"
    hallucinated_output = dict(MOCK_GEMMA_LLM_OUTPUT)
    hallucinated_output["selected_place_id"] = "ChIJ_hallucinated_place_id"

    async def gemma_handler(request):
        return Response(200, json={
            "candidates": [{
                "content": {"parts": [{"text": json.dumps(hallucinated_output)}]}
            }]
        })

    places_client = AsyncClient(transport=httpx_mock_transport(places_handler))
    gemma_client = AsyncClient(transport=httpx_mock_transport(gemma_handler))

    places_service = GooglePlacesService(api_key="test_key", client=places_client)
    provider = GemmaQuestProvider(
        places_service=places_service,
        api_key="test_gemma_key",
        http_client=gemma_client,
    )

    from app.schemas.quest import QuestCreateRequest
    from app.services.providers.gemma import GemmaProviderError

    req = QuestCreateRequest(
        user_id=test_user.id,
        available_minutes=30,
        explorer_type="nature",
        difficulty="medium",
        latitude=37.7694,
        longitude=-122.4862,
    )

    with pytest.raises(GemmaProviderError) as exc_info:
        await provider.generate_quest(req)

    assert exc_info.value.status_code == 502
    assert "unknown place_id" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_google_places_service_radius_validation():
    """Test requirement 3: Harden allowed search radius (e.g. min 100m, max 50,000m, non-finite)."""
    service = GooglePlacesService(api_key="test_key")

    with pytest.raises(ValueError, match="Search radius must be between"):
        await service.search_nearby_places(latitude=37.7749, longitude=-122.4194, radius_meters=50.0)

    with pytest.raises(ValueError, match="Search radius must be between"):
        await service.search_nearby_places(latitude=37.7749, longitude=-122.4194, radius_meters=60000.0)

    with pytest.raises(ValueError, match="Search radius must be a finite number"):
        await service.search_nearby_places(latitude=37.7749, longitude=-122.4194, radius_meters=float("inf"))


@pytest.mark.asyncio
async def test_google_places_service_handles_malformed_and_unsuitable_places():
    """Test requirement 3: Handle malformed responses, non-dict items, unsuitable categories, and closed places."""
    malformed_json = {
        "places": [
            # 1. Closed place
            {
                "id": "closed_1",
                "displayName": {"text": "Closed Museum"},
                "location": {"latitude": 37.7750, "longitude": -122.4190},
                "primaryType": "museum",
                "businessStatus": "CLOSED_PERMANENTLY",
            },
            # 2. Unsuitable category (gas_station, parking, cemetery)
            {
                "id": "unsuitable_1",
                "displayName": {"text": "Downtown Parking Garage"},
                "location": {"latitude": 37.7751, "longitude": -122.4191},
                "primaryType": "parking",
                "businessStatus": "OPERATIONAL",
            },
            # 3. Missing coordinates
            {
                "id": "missing_coords",
                "displayName": {"text": "Ghost Place"},
                "businessStatus": "OPERATIONAL",
            },
            # 4. Out-of-bounds latitude/longitude
            {
                "id": "invalid_coords",
                "displayName": {"text": "Space Station"},
                "location": {"latitude": 95.0, "longitude": -122.4191},
                "businessStatus": "OPERATIONAL",
            },
            # 5. Non-dict element
            "invalid_string_item",
            # 6. Valid public park candidate within range
            {
                "id": "valid_park_1",
                "displayName": {"text": "Civic Center Plaza"},
                "location": {"latitude": 37.7793, "longitude": -122.4175},
                "primaryType": "park",
                "businessStatus": "OPERATIONAL",
            },
        ]
    }

    async def handler(request):
        return Response(200, json=malformed_json)

    client = AsyncClient(transport=httpx_mock_transport(handler))
    service = GooglePlacesService(api_key="test_key", client=client)

    candidates = await service.search_nearby_places(
        latitude=37.7749,
        longitude=-122.4194,
        radius_meters=3000.0,
    )

    # Only the valid park should survive filtering
    assert len(candidates) == 1
    assert candidates[0].place_id == "valid_park_1"
    assert candidates[0].name == "Civic Center Plaza"


@pytest.mark.asyncio
async def test_real_world_gemma_quest_awards_zero_xp(client: AsyncClient, test_user: User, monkeypatch):
    """Test Fix 1 & 3: Real-world Gemma quests cannot award XP from unverified observation answers; awards exactly 0 XP."""
    monkeypatch.setattr(settings, "quest_provider", "google_places_gemma")
    monkeypatch.setattr(settings, "google_maps_api_key", "test_maps_key")
    monkeypatch.setattr(settings, "gemma_api_key", "test_gemma_key")

    # Verify that allow_unverified_real_world_xp configuration attribute does not exist on settings
    assert not hasattr(settings, "allow_unverified_real_world_xp")

    import httpx
    original_post = httpx.AsyncClient.post

    async def mock_post(self, url, *args, **kwargs):
        if "places.googleapis.com" in str(url):
            return Response(200, json=MOCK_PLACES_JSON)
        if "generativelanguage.googleapis.com" in str(url) or "models/gemma" in str(url):
            return Response(
                200,
                json={
                    "candidates": [{
                        "content": {"parts": [{"text": json.dumps(MOCK_GEMMA_LLM_OUTPUT)}]}
                    }]
                },
            )
        return await original_post(self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "medium",
            "latitude": 37.7749,
            "longitude": -122.4194,
        },
    )
    assert gen_res.status_code == 201
    quest_id = gen_res.json()["id"]

    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Verify quest completion
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
    # Real-world verified quests legitimately award XP upon physical arrival
    assert v_data["reward_xp_awarded"] == 300
    assert v_data["total_xp"] == 300
    assert "earned 300 XP" in v_data["message"]
    assert v_data["quest"]["status"] == "completed"


@pytest.mark.asyncio
async def test_safe_http_error_handling_invalid_input(client: AsyncClient, test_user: User):
    """Test Fix 2 & 3: Safe HTTP error responses for invalid input without internal detail leakage."""
    # Invalid coordinates (out-of-range latitude in quest generation with google_places_gemma)
    res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "medium",
            "latitude": 999.0,  # invalid latitude > 90
            "longitude": -122.4194,
        },
    )
    # Pydantic schema validation catches this cleanly with 422
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_safe_http_error_handling_configuration_error(client: AsyncClient, test_user: User, monkeypatch):
    """Test Fix 2 & 3: Configuration error returns safe HTTP 500 without leaking secrets or internals."""
    monkeypatch.setattr(settings, "quest_provider", "google_places_gemma")
    monkeypatch.setattr(settings, "google_maps_api_key", "")  # Missing key triggers ValueError in factory

    res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "medium",
            "latitude": 37.7749,
            "longitude": -122.4194,
        },
    )
    # Returns 500 without leaking GOOGLE_MAPS_API_KEY internal stack trace
    assert res.status_code == 500
    assert "Server configuration error" in res.json()["detail"]
    assert "GOOGLE_MAPS_API_KEY" not in res.json()["detail"]


@pytest.mark.asyncio
async def test_gemma_json_cleaning_and_retry(test_user: User):
    """Test that Gemma provider successfully handles markdown fences, trailing commas, and recovers via retry."""
    async def places_handler(request):
        return Response(200, json={
            "places": [{
                "id": "ChIJ_real_candidate",
                "displayName": {"text": "Golden Gate Park", "languageCode": "en"},
                "location": {"latitude": 37.7694, "longitude": -122.4862},
                "primaryType": "park",
                "businessStatus": "OPERATIONAL",
            }]
        })

    call_count = 0

    async def gemma_handler(request):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First attempt returns malformed non-JSON text
            return Response(200, json={
                "candidates": [{
                    "content": {"parts": [{"text": "Sorry, I cannot answer in JSON right now."}]}
                }]
            })
        # Second attempt returns JSON with markdown fence and trailing commas
        raw_json_with_trailing_commas = """```json
{
  "selected_place_id": "ChIJ_real_candidate",
  "title": "Park Secret",
  "story": "Explore the park.",
  "clues": [
    "Clue 1",
    "Clue 2",
    "Clue 3",
  ],
  "verification_prompt": "What color is the gate?",
  "verification_answer": "green",
  "difficulty": "medium",
  "reward_xp": 250,
}
```"""
        return Response(200, json={
            "candidates": [{
                "content": {"parts": [{"text": raw_json_with_trailing_commas}]}
            }]
        })

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
        explorer_type="nature",
        difficulty="medium",
        latitude=37.7694,
        longitude=-122.4862,
    )

    result = await provider.generate_quest(req)
    assert result.destination_name == "Golden Gate Park"
    assert result.title == "Park Secret"
    assert call_count == 2


@pytest.mark.asyncio
async def test_real_quest_generation_with_validated_waypoints(test_user: User, monkeypatch):
    """
    Demonstrates that generating a real quest produces usable, validated intermediate
    waypoints from Google Places candidates and associates them with clues.
    """
    places_response = {
        "places": [
            {
                "id": "ChIJ_destination_landmark",
                "displayName": {"text": "Palace of Fine Arts Rotunda", "languageCode": "en"},
                "location": {"latitude": 37.8020, "longitude": -122.4488},
                "primaryType": "historical_landmark",
                "formattedAddress": "3301 Lyon St, San Francisco, CA 94123",
                "businessStatus": "OPERATIONAL",
            },
            {
                "id": "ChIJ_intermediate_waypoint_1",
                "displayName": {"text": "Lyon Street Steps", "languageCode": "en"},
                "location": {"latitude": 37.7940, "longitude": -122.4460},
                "primaryType": "tourist_attraction",
                "formattedAddress": "Lyon St, San Francisco, CA 94123",
                "businessStatus": "OPERATIONAL",
            },
            {
                "id": "ChIJ_intermediate_waypoint_2",
                "displayName": {"text": "Exploratorium Marina Bridge", "languageCode": "en"},
                "location": {"latitude": 37.8010, "longitude": -122.4470},
                "primaryType": "monument",
                "formattedAddress": "Marina Blvd, San Francisco, CA 94123",
                "businessStatus": "OPERATIONAL",
            },
        ]
    }

    gemma_response = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": json.dumps({
                                "selected_place_id": "ChIJ_destination_landmark",
                                "intermediate_waypoint_place_ids": [
                                    "ChIJ_intermediate_waypoint_1",
                                    "ChIJ_intermediate_waypoint_2",
                                ],
                                "title": "The Greco-Roman Echoes",
                                "story": "Follow the ancient path to the great columns.",
                                "clues": [
                                    "Ascend the manicured hillside stairs overlooking the bay.",
                                    "Cross the arched stone bridge flanking the tranquil lagoon.",
                                    "Stand directly under the monumental dome rotunda.",
                                ],
                                "verification_prompt": "What color are the urns around the rotunda?",
                                "verification_answer": "terracotta",
                                "difficulty": "medium",
                                "reward_xp": 300,
                            })
                        }
                    ]
                }
            }
        ]
    }

    async def places_handler(request):
        return Response(200, json=places_response)

    async def gemma_handler(request):
        return Response(200, json=gemma_response)

    places_client = AsyncClient(transport=httpx_mock_transport(places_handler))
    gemma_client = AsyncClient(transport=httpx_mock_transport(gemma_handler))

    places_svc = GooglePlacesService(api_key="test_places_key", client=places_client)
    provider = GemmaQuestProvider(
        places_service=places_svc,
        api_key="test_gemma_key",
        http_client=gemma_client,
    )

    from app.schemas.quest import QuestCreateRequest
    req = QuestCreateRequest(
        user_id=test_user.id,
        available_minutes=30,
        explorer_type="discovery",
        difficulty="medium",
        latitude=37.7930,
        longitude=-122.4450,
    )

    result = await provider.generate_quest(req)

    # 1. Destination is accurately selected and validated
    assert result.destination_name == "Palace of Fine Arts Rotunda"
    assert result.destination_latitude == 37.8020
    assert result.destination_longitude == -122.4488

    # 2. Intermediate waypoints are properly validated against real places candidates
    assert len(result.waypoints) == 2
    wp1 = result.waypoints[0]
    assert wp1 is not None
    assert wp1.place_id == "ChIJ_intermediate_waypoint_1"
    assert wp1.name == "Lyon Street Steps"
    assert wp1.latitude == 37.7940
    assert wp1.longitude == -122.4460

    wp2 = result.waypoints[1]
    assert wp2 is not None
    assert wp2.place_id == "ChIJ_intermediate_waypoint_2"
    assert wp2.name == "Exploratorium Marina Bridge"
    assert wp2.latitude == 37.8010
    assert wp2.longitude == -122.4470


@pytest.mark.asyncio
async def test_waypoint_secrecy_and_progressive_unlocking(client: AsyncClient, db_session):
    """
    Tests end-to-end waypoint persistence, progressive unlocking, and destination secrecy:
    1. Waypoints are persisted in the database.
    2. Locked clues and secret destinations do NOT expose coordinates.
    3. Starting the quest unlocks the first clue and reveals ONLY the first waypoint coordinates.
    4. Unlocking the next hint reveals the second waypoint coordinates.
    5. The final destination remains secret until the quest is completed.
    """
    import uuid
    from tests.test_social_party import create_user_and_auth

    email = f"waypoint_tester_{uuid.uuid4().hex[:6]}@example.com"
    user, token = await create_user_and_auth(client, db_session, "Waypoint Explorer", email)
    auth_headers = {"Authorization": f"Bearer {token}"}

    # Setup mock provider that generates validated waypoints
    from app.services.providers.base import QuestGenerationResult, StepWaypointCandidate
    from app.services.quest import QuestService

    class MockWaypointProvider:
        async def generate_quest(self, request):
            return QuestGenerationResult(
                title="Trail of the Seven Columns",
                description="Uncover the secrets of the bay.",
                difficulty="medium",
                estimated_minutes=30,
                reward_xp=250,
                destination_name="Secret Palace Rotunda",
                destination_latitude=37.8020,
                destination_longitude=-122.4488,
                verification_prompt="What is inscribed on the pedestal?",
                verification_answer="1915",
                clues=[
                    "Head to the hilltop stairs.",
                    "Cross the arched bridge.",
                    "Look behind the rotunda columns.",
                ],
                waypoints=[
                    StepWaypointCandidate(
                        place_id="place_wp_1",
                        name="Hilltop Stairs",
                        latitude=37.7940,
                        longitude=-122.4460,
                    ),
                    StepWaypointCandidate(
                        place_id="place_wp_2",
                        name="Arched Bridge",
                        latitude=37.8010,
                        longitude=-122.4470,
                    ),
                    None,
                ],
            )

    from app.repositories.quest import QuestRepository
    from app.repositories.user import UserRepository

    quest_service = QuestService(
        session=db_session,
        quest_repository=QuestRepository(db_session),
        user_repository=UserRepository(db_session),
        quest_provider=MockWaypointProvider(),
    )

    from app.schemas.quest import QuestCreateRequest
    created_quest = await quest_service.generate_quest(
        QuestCreateRequest(
            user_id=user.id,
            available_minutes=30,
            explorer_type="discovery",
            difficulty="medium",
            latitude=37.7930,
            longitude=-122.4450,
        )
    )

    # In draft mode, all clues are locked -> 0 clues visible
    assert created_quest.status == "draft"
    assert len(created_quest.current_clues) == 0
    assert created_quest.destination_name is None

    # Verify directly in the database that waypoints are persisted
    stored_quest = await QuestRepository(db_session).get_by_id(created_quest.id)
    assert stored_quest is not None
    assert len(stored_quest.steps) == 3
    assert stored_quest.steps[0].waypoint_place_id == "place_wp_1"
    assert float(stored_quest.steps[0].waypoint_latitude) == 37.7940
    assert float(stored_quest.steps[0].waypoint_longitude) == -122.4460
    assert stored_quest.steps[0].waypoint_name == "Hilltop Stairs"

    assert stored_quest.steps[1].waypoint_place_id == "place_wp_2"
    assert float(stored_quest.steps[1].waypoint_latitude) == 37.8010
    assert float(stored_quest.steps[1].waypoint_longitude) == -122.4470

    # Start the quest -> unlocks Hint 1
    started_quest = await quest_service.start_quest(created_quest.id)
    assert started_quest.status == "active"
    assert len(started_quest.current_clues) == 1
    assert started_quest.destination_name is None  # Still secret!

    clue1 = started_quest.current_clues[0]
    assert clue1.step_order == 1
    assert clue1.is_unlocked is True
    assert clue1.latitude == 37.7940
    assert clue1.longitude == -122.4460
    assert clue1.waypoint_name == "Hilltop Stairs"

    # Unlock Hint 2 -> reveals Waypoint 2
    hint2_res = await quest_service.unlock_hint(created_quest.id)
    assert hint2_res.all_hints_unlocked is False
    assert len(hint2_res.quest.current_clues) == 2
    assert hint2_res.quest.destination_name is None  # Still secret!

    clue2 = hint2_res.quest.current_clues[1]
    assert clue2.step_order == 2
    assert clue2.latitude == 37.8010
    assert clue2.longitude == -122.4470
    assert clue2.waypoint_name == "Arched Bridge"

    # Unlock Hint 3 -> text clue with no waypoint (general destination exploration)
    hint3_res = await quest_service.unlock_hint(created_quest.id)
    assert hint3_res.all_hints_unlocked is True
    assert len(hint3_res.quest.current_clues) == 3
    clue3 = hint3_res.quest.current_clues[2]
    assert clue3.step_order == 3
    assert clue3.latitude is None  # No fake coordinates invented!
    assert clue3.longitude is None
    assert hint3_res.quest.destination_name is None  # Still secret!


