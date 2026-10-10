import asyncio
import uuid
import pytest
from httpx import AsyncClient

from app.core.geo import calculate_haversine_distance_meters, calculate_profile_level
from app.models.user import User


# 1. Geographic Calculation Tests
def test_haversine_distance():
    # Coit Tower to Ferry Building (~1400m)
    lat1, lon1 = 37.8024, -122.4058
    lat2, lon2 = 37.7955, -122.3937
    dist = calculate_haversine_distance_meters(lat1, lon1, lat2, lon2)
    assert 1200 < dist < 1600

    # Same location distance is 0
    assert calculate_haversine_distance_meters(lat1, lon1, lat1, lon1) == 0.0


def test_haversine_invalid_coordinates():
    with pytest.raises(ValueError, match="Geographic coordinates must be finite real numbers."):
        calculate_haversine_distance_meters(float("nan"), 0.0, 10.0, 20.0)

    # Out-of-range latitude tests (< -90 or > 90)
    with pytest.raises(ValueError, match="Latitude must be between -90 and 90 degrees"):
        calculate_haversine_distance_meters(91.0, 0.0, 10.0, 20.0)

    with pytest.raises(ValueError, match="Latitude must be between -90 and 90 degrees"):
        calculate_haversine_distance_meters(0.0, 0.0, -90.5, 20.0)

    # Out-of-range longitude tests (< -180 or > 180)
    with pytest.raises(ValueError, match="Longitude must be between -180 and 180 degrees"):
        calculate_haversine_distance_meters(0.0, 181.0, 10.0, 20.0)

    with pytest.raises(ValueError, match="Longitude must be between -180 and 180 degrees"):
        calculate_haversine_distance_meters(0.0, 0.0, 10.0, -180.1)


def test_level_calculation_formula():
    assert calculate_profile_level(0) == 1
    assert calculate_profile_level(499) == 1
    assert calculate_profile_level(500) == 2
    assert calculate_profile_level(999) == 2
    assert calculate_profile_level(1000) == 3


# 2. Quest Generation Tests
@pytest.mark.asyncio
async def test_quest_generation(client: AsyncClient, test_user: User):
    payload = {
        "user_id": str(test_user.id),
        "available_minutes": 30,
        "explorer_type": "mystery",
        "difficulty": "medium",
    }
    response = await client.post("/api/v1/quests/generate", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "draft"
    assert data["title"].startswith("[Simulated Demo] The")
    assert data["estimated_minutes"] == 30
    assert data["reward_xp"] > 0
    # Clues are not yet unlocked in draft
    assert len(data["current_clues"]) == 0
    # Destination name and coordinates MUST NOT leak
    assert data["destination_name"] is None
    assert "destination_latitude" not in data
    assert "destination_longitude" not in data


@pytest.mark.asyncio
async def test_quest_generation_missing_user(client: AsyncClient):
    random_user_id = str(uuid.uuid4())
    payload = {
        "user_id": random_user_id,
        "available_minutes": 15,
        "explorer_type": "discovery",
        "difficulty": "easy",
    }
    response = await client.post("/api/v1/quests/generate", json=payload)
    assert response.status_code == 404
    assert f"User {random_user_id} not found" in response.json()["detail"]


# 3. Quest Start & First Clue
@pytest.mark.asyncio
async def test_quest_start_and_first_clue(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "discovery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]

    # Start quest
    start_res = await client.post(f"/api/v1/quests/{quest_id}/start")
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert start_data["status"] == "active"
    assert start_data["started_at"] is not None
    # First clue unlocked
    assert len(start_data["current_clues"]) == 1
    assert start_data["current_clues"][0]["step_order"] == 1
    assert start_data["current_clues"][0]["is_unlocked"] is True
    # Destination name still hidden
    assert start_data["destination_name"] is None


# 4. Starting already active quest
@pytest.mark.asyncio
async def test_starting_already_active_quest(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "discovery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Second start attempt -> 409 Conflict
    conflict_res = await client.post(f"/api/v1/quests/{quest_id}/start")
    assert conflict_res.status_code == 409
    assert "already active" in conflict_res.json()["detail"]


# 5. Hint Progression
@pytest.mark.asyncio
async def test_hint_progression(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]

    # Hint on draft -> 409 Conflict
    hint_draft = await client.post(f"/api/v1/quests/{quest_id}/hint")
    assert hint_draft.status_code == 409

    # Start quest (step 1 unlocked)
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Request hint -> step 2 unlocked
    hint1 = await client.post(f"/api/v1/quests/{quest_id}/hint")
    assert hint1.status_code == 200
    h1_data = hint1.json()
    assert h1_data["unlocked_step"]["step_order"] == 2
    assert len(h1_data["quest"]["current_clues"]) == 2

    # Request hint -> step 3 unlocked
    hint2 = await client.post(f"/api/v1/quests/{quest_id}/hint")
    assert hint2.status_code == 200
    h2_data = hint2.json()
    assert h2_data["unlocked_step"]["step_order"] == 3
    assert h2_data["all_hints_unlocked"] is True

    # Request hint after all unlocked
    hint3 = await client.post(f"/api/v1/quests/{quest_id}/hint")
    assert hint3.status_code == 200
    assert hint3.json()["unlocked_step"] is None
    assert hint3.json()["all_hints_unlocked"] is True


# 6. Hidden destination leak check
@pytest.mark.asyncio
async def test_hidden_destination_not_leaked(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 30,
            "explorer_type": "nature",
            "difficulty": "hard",
        },
    )
    quest_id = gen_res.json()["id"]

    get_res = await client.get(f"/api/v1/quests/{quest_id}")
    assert get_res.status_code == 200
    quest_data = get_res.json()
    assert quest_data["destination_name"] is None
    assert "destination_latitude" not in quest_data
    assert "destination_longitude" not in quest_data
    assert "verification_answer" not in quest_data


# 7. State Transitions: Abandon and Invalids
@pytest.mark.asyncio
async def test_invalid_state_transitions(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "fitness",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]

    # Abandon from draft -> active allowed? Yes, draft -> abandoned is allowed
    abandon_res = await client.post(f"/api/v1/quests/{quest_id}/abandon")
    assert abandon_res.status_code == 200
    assert abandon_res.json()["status"] == "abandoned"

    # Start abandoned quest -> 409
    start_abandoned = await client.post(f"/api/v1/quests/{quest_id}/start")
    assert start_abandoned.status_code == 409

    # Abandon already abandoned quest -> 409
    abandon_again = await client.post(f"/api/v1/quests/{quest_id}/abandon")
    assert abandon_again.status_code == 409


# 8. Verification: Outside radius, incorrect answer, non-finite coords
@pytest.mark.asyncio
async def test_verification_failures(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "mystery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # 8a: Verify far away coordinates (e.g., latitude 0, longitude 0)
    far_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 0.0,
            "longitude": 0.0,
            "observation_answer": "owl",
        },
    )
    assert far_res.status_code == 400
    assert "not within the target destination area" in far_res.json()["detail"]

    # 8b: Nearby coordinates, but wrong observation answer
    wrong_answer_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 37.779260,
            "longitude": -122.416040,
            "observation_answer": "completely_wrong_answer",
        },
    )
    assert wrong_answer_res.status_code == 400
    # Must NOT reveal expected answer in response
    assert "owl" not in wrong_answer_res.json()["detail"]

    # 8c: Invalid non-finite coordinates
    invalid_coords_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 999.0,  # exceeds lat constraint [-90, 90]
            "longitude": 0.0,
            "observation_answer": "owl",
        },
    )
    assert invalid_coords_res.status_code == 422


# 9. Successful Quest Completion, XP awarded, destination revealed
@pytest.mark.asyncio
async def test_successful_quest_completion(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "mystery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]
    reward_xp = gen_res.json()["reward_xp"]
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Target destination for this deterministic configuration is Library Courtyard
    # Lat: 37.779260, Lon: -122.416040, Answer: 'owl'
    verify_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 37.779260,
            "longitude": -122.416040,
            "observation_answer": "  OWL  ",  # tests case-insensitivity and trim
        },
    )
    assert verify_res.status_code == 200
    v_data = verify_res.json()
    assert v_data["success"] is True
    assert v_data["reward_xp_awarded"] == reward_xp
    assert v_data["total_xp"] == reward_xp
    assert v_data["quest"]["status"] == "completed"
    # Destination name is NOW revealed
    assert v_data["quest"]["destination_name"] is not None

    # Check profile endpoint reflects updated XP and level
    prof_res = await client.get(f"/api/v1/users/{test_user.id}/profile")
    assert prof_res.status_code == 200
    assert prof_res.json()["xp"] == reward_xp

    # 10. Repeated verification attempt on completed quest -> 409
    repeat_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": 37.779260,
            "longitude": -122.416040,
            "observation_answer": "owl",
        },
    )
    assert repeat_res.status_code == 409
    assert "already completed" in repeat_res.json()["detail"]

    # 11. Abandoning a completed quest -> 409
    abandon_completed = await client.post(f"/api/v1/quests/{quest_id}/abandon")
    assert abandon_completed.status_code == 409


# 12. Profile level progression with multiple quests
@pytest.mark.asyncio
async def test_profile_level_progression(client: AsyncClient, test_user: User):
    # Complete hard 60 min quest to gain significant XP (350 + 200 = 550 XP -> Level 2)
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 60,
            "explorer_type": "fitness",
            "difficulty": "hard",
        },
    )
    quest = gen_res.json()
    quest_id = quest["id"]
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Check which destination was picked by checking quest title
    # For fitness/hard/60, it picks Maritime Compass Rose (Pier 39, answer: 1934, lat: 37.8086, lon: -122.40982)
    # or Vista Hilltop Pavilion (answer: green, lat: 37.769420, lon: -122.446747)
    answer = "green" if "Pavilion" in quest["title"] else "1934"
    lat = 37.769420 if "Pavilion" in quest["title"] else 37.808600
    lon = -122.446747 if "Pavilion" in quest["title"] else -122.409820

    verify_res = await client.post(
        f"/api/v1/quests/{quest_id}/verify",
        json={
            "latitude": lat,
            "longitude": lon,
            "observation_answer": answer,
        },
    )
    assert verify_res.status_code == 200
    prof = verify_res.json()
    assert prof["total_xp"] >= 500
    assert prof["level"] >= 2


# 13. Quest History
@pytest.mark.asyncio
async def test_user_quest_history(client: AsyncClient, test_user: User):
    # Generate a quest for the user first
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "mystery",
            "difficulty": "easy",
        },
    )
    assert gen_res.status_code == 201

    history_res = await client.get(f"/api/v1/users/{test_user.id}/quests")
    assert history_res.status_code == 200
    history = history_res.json()
    assert isinstance(history, list)
    assert len(history) >= 1
    assert history[0]["id"] == gen_res.json()["id"]


# 14. Missing quest / user endpoints
@pytest.mark.asyncio
async def test_missing_quest_and_user_404(client: AsyncClient):
    random_id = str(uuid.uuid4())
    res_quest = await client.get(f"/api/v1/quests/{random_id}")
    assert res_quest.status_code == 404

    res_user = await client.get(f"/api/v1/users/{random_id}/profile")
    assert res_user.status_code == 404

    res_user_quests = await client.get(f"/api/v1/users/{random_id}/quests")
    assert res_user_quests.status_code == 404


# 15. Concurrent verification attempts (XP awarded exactly once)
@pytest.mark.asyncio
async def test_concurrent_verification_attempts(client: AsyncClient, test_user: User):
    gen_res = await client.post(
        "/api/v1/quests/generate",
        json={
            "user_id": str(test_user.id),
            "available_minutes": 15,
            "explorer_type": "mystery",
            "difficulty": "easy",
        },
    )
    quest_id = gen_res.json()["id"]
    await client.post(f"/api/v1/quests/{quest_id}/start")

    # Fire two concurrent verification requests
    payload = {
        "latitude": 37.779260,
        "longitude": -122.416040,
        "observation_answer": "owl",
    }

    results = await asyncio.gather(
        client.post(f"/api/v1/quests/{quest_id}/verify", json=payload),
        client.post(f"/api/v1/quests/{quest_id}/verify", json=payload),
        return_exceptions=True,
    )

    statuses = [r.status_code for r in results if not isinstance(r, Exception)]
    # Exactly one must succeed (200), and the other must be 409 conflict
    assert 200 in statuses
    assert 409 in statuses

    # Regression check: verify profile XP was incremented exactly once
    prof_res = await client.get(f"/api/v1/users/{test_user.id}/profile")
    assert prof_res.status_code == 200
    expected_xp = gen_res.json()["reward_xp"]
    assert prof_res.json()["xp"] == expected_xp
