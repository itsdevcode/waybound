import pytest
from httpx import AsyncClient

from app.models.user import User


@pytest.mark.asyncio
async def test_nearby_quests_validation(client: AsyncClient):
    # Invalid latitude (< -90)
    res = await client.get("/api/v1/quests/nearby?latitude=95.0&longitude=-122.41")
    assert res.status_code == 422

    # Invalid longitude (> 180)
    res = await client.get("/api/v1/quests/nearby?latitude=37.77&longitude=185.0")
    assert res.status_code == 422

    # Invalid radius (< 100m)
    res = await client.get("/api/v1/quests/nearby?latitude=37.77&longitude=-122.41&radius_meters=50")
    assert res.status_code == 422

    # Invalid radius (> 50,000m)
    res = await client.get("/api/v1/quests/nearby?latitude=37.77&longitude=-122.41&radius_meters=60000")
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_nearby_quests_discovery_sf(client: AsyncClient):
    # San Francisco center
    sf_lat = 37.7749
    sf_lon = -122.4194

    # 10km radius covers SF demo destinations
    res = await client.get(
        f"/api/v1/quests/nearby?latitude={sf_lat}&longitude={sf_lon}&radius_meters=10000"
    )
    assert res.status_code == 200
    data = res.json()

    assert "items" in data
    assert data["center_latitude"] == sf_lat
    assert data["center_longitude"] == sf_lon
    assert data["radius_meters"] == 10000.0
    assert data["total_count"] > 0

    first = data["items"][0]
    assert "id" in first
    assert "title" in first
    assert "description" in first
    assert "difficulty" in first
    assert "estimated_minutes" in first
    assert "reward_xp" in first
    assert "status" in first
    assert "latitude" in first
    assert "longitude" in first
    assert "distance_meters" in first
    assert "verification_radius_meters" in first
    assert first["verification_radius_meters"] == 100.0
    # Items should be ordered by distance
    distances = [item["distance_meters"] for item in data["items"]]
    assert distances == sorted(distances)


@pytest.mark.asyncio
async def test_nearby_quests_empty_remote_location(client: AsyncClient):
    # Coordinates in remote ocean / Antarctic waters with no destinations
    res = await client.get(
        "/api/v1/quests/nearby?latitude=-60.0&longitude=-140.0&radius_meters=1000"
    )
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] == 0
    assert len(data["items"]) == 0


@pytest.mark.asyncio
async def test_nearby_quests_includes_active_user_quest(
    client: AsyncClient, db_session
):
    import uuid
    from tests.test_social_party import create_user_and_auth

    email = f"map_explorer_{uuid.uuid4().hex[:6]}@example.com"
    user, token = await create_user_and_auth(client, db_session, "Map Explorer", email)
    auth_headers = {"Authorization": f"Bearer {token}"}

    # Generate and start a quest for user in SF
    payload = {
        "user_id": str(user.id),
        "available_minutes": 30,
        "explorer_type": "mystery",
        "difficulty": "medium",
        "latitude": 37.7749,
        "longitude": -122.4194,
    }
    create_res = await client.post("/api/v1/quests/generate", json=payload, headers=auth_headers)
    assert create_res.status_code == 201
    quest_id = create_res.json()["id"]

    start_res = await client.post(f"/api/v1/quests/{quest_id}/start", headers=auth_headers)
    assert start_res.status_code == 200
    assert start_res.json()["status"] == "active"

    # Search nearby with auth headers
    res = await client.get(
        "/api/v1/quests/nearby?latitude=37.7749&longitude=-122.4194&radius_meters=10000",
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()

    active_items = [item for item in data["items"] if item["id"] == quest_id]
    assert len(active_items) == 1
    assert active_items[0]["status"] == "active"
    assert active_items[0]["is_active"] is True


@pytest.mark.asyncio
async def test_nearby_quests_google_places_discovery(monkeypatch: pytest.MonkeyPatch, client: AsyncClient):
    """Test that when Google Places provider returns POIs, they are returned with is_simulated=False."""
    from app.core.config import settings
    from app.schemas.place import PlaceCandidate
    from app.services.places import GooglePlacesService

    monkeypatch.setattr(settings, "google_maps_api_key", "test-api-key")

    mock_candidates = [
        PlaceCandidate(
            place_id="places_chicago_art_inst",
            name="Art Institute of Chicago",
            address="111 S Michigan Ave, Chicago, IL",
            latitude=41.8796,
            longitude=-87.6237,
            primary_type="museum",
            business_status="OPERATIONAL",
            distance_meters=150.0,
        ),
        PlaceCandidate(
            place_id="places_millennium_park",
            name="Millennium Park",
            address="201 E Randolph St, Chicago, IL",
            latitude=41.8826,
            longitude=-87.6226,
            primary_type="park",
            business_status="OPERATIONAL",
            distance_meters=320.0,
        ),
    ]

    async def mock_search(self, *args, **kwargs) -> list[PlaceCandidate]:
        return mock_candidates

    monkeypatch.setattr(GooglePlacesService, "search_nearby_places", mock_search)

    # Center near Chicago Loop
    res = await client.get(
        "/api/v1/quests/nearby?latitude=41.88&longitude=-87.625&radius_meters=3000"
    )
    assert res.status_code == 200
    data = res.json()

    assert data["total_count"] == 2
    assert len(data["items"]) == 2
    for item in data["items"]:
        assert item["is_simulated"] is False
        assert "Simulated POI" not in item["title"]
        assert item["verification_radius_meters"] == settings.verification_radius_meters

    titles = [item["title"] for item in data["items"]]
    assert any("Art Institute of Chicago" in t for t in titles)
    assert any("Millennium Park" in t for t in titles)


@pytest.mark.asyncio
async def test_nearby_quests_provider_failure_falls_back_to_demo(monkeypatch: pytest.MonkeyPatch, client: AsyncClient):
    """When Google Places provider raises an error or fails, fallback safely to demo destinations labeled as simulated."""
    from app.core.config import settings
    from app.services.places import GooglePlacesService

    monkeypatch.setattr(settings, "google_maps_api_key", "test-api-key")

    async def mock_failing_search(self, *args, **kwargs):
        raise RuntimeError("Google Places API quota exceeded or network timeout")

    monkeypatch.setattr(GooglePlacesService, "search_nearby_places", mock_failing_search)

    # Request near San Francisco where demo locations exist
    sf_lat = 37.7749
    sf_lon = -122.4194
    res = await client.get(
        f"/api/v1/quests/nearby?latitude={sf_lat}&longitude={sf_lon}&radius_meters=5000"
    )
    assert res.status_code == 200
    data = res.json()

    # Must fall back gracefully to demo destinations and explicitly label them simulated
    assert data["total_count"] > 0
    first = data["items"][0]
    assert first["is_simulated"] is True
    assert "[Demo Scenario]" in first["title"]
    assert "0 XP" in first["description"]


@pytest.mark.asyncio
async def test_nearby_cities_endpoint_discovery_and_caching(monkeypatch: pytest.MonkeyPatch, client: AsyncClient):
    """Test discovery of nearby cities using Google Places provider with caching and distance sorting."""
    from app.core.config import settings
    from app.schemas.place import CitySuggestion
    from app.services.places import GooglePlacesService, _CITIES_CACHE

    _CITIES_CACHE.clear()
    monkeypatch.setattr(settings, "google_maps_api_key", "test-api-key")

    mock_cities = [
        CitySuggestion(
            name="Berkeley",
            region="California",
            country="United States",
            latitude=37.8715,
            longitude=-122.2730,
            place_id="ChIJ0zPScFa4j4ARvBueyog_A",
            distance_km=17.2,
        ),
        CitySuggestion(
            name="Oakland",
            region="California",
            country="United States",
            latitude=37.8044,
            longitude=-122.2711,
            place_id="ChIJqSNu0IuAj4ARsM_98LwL3W4",
            distance_km=14.8,
        ),
    ]

    async def mock_discover(self, latitude: float, longitude: float, limit: int = 6):
        return mock_cities

    monkeypatch.setattr(GooglePlacesService, "discover_nearby_cities", mock_discover)

    # Valid coordinates
    res = await client.get("/api/v1/quests/nearby-cities?latitude=37.7749&longitude=-122.4194&limit=5")
    assert res.status_code == 200
    cities = res.json()
    assert len(cities) == 2
    assert cities[0]["name"] in ["Berkeley", "Oakland"]
    assert cities[0]["region"] == "California"

    # Validation bounds: invalid latitude
    res_invalid_lat = await client.get("/api/v1/quests/nearby-cities?latitude=95.0&longitude=-122.4194")
    assert res_invalid_lat.status_code == 422

    # Validation bounds: invalid longitude
    res_invalid_lng = await client.get("/api/v1/quests/nearby-cities?latitude=37.77&longitude=190.0")
    assert res_invalid_lng.status_code == 422


@pytest.mark.asyncio
async def test_nearby_cities_endpoint_provider_failure_returns_empty_list(monkeypatch: pytest.MonkeyPatch, client: AsyncClient):
    """When Places API fails or raises an error, nearby-cities gracefully returns an empty list without inventing cities."""
    from app.services.places import GooglePlacesService, _CITIES_CACHE

    _CITIES_CACHE.clear()

    async def mock_failing_discover(self, latitude: float, longitude: float, limit: int = 6):
        raise RuntimeError("Places API outage")

    monkeypatch.setattr(GooglePlacesService, "discover_nearby_cities", mock_failing_discover)

    res = await client.get("/api/v1/quests/nearby-cities?latitude=37.7749&longitude=-122.4194")
    assert res.status_code == 200
    assert res.json() == []



