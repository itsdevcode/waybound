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

