import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import Profile
from app.models.user import User


async def create_user_and_auth(
    client: AsyncClient, db_session: AsyncSession, name: str, email: str
) -> tuple[User, str]:
    user = User(name=name, email=email)
    profile = Profile(user=user, explorer_type="mystery", level=1, xp=0)
    db_session.add(user)
    db_session.add(profile)
    await db_session.commit()
    await db_session.refresh(user, ["profile"])

    resp = await client.post("/api/v1/auth/session", json={"user_id": str(user.id)})
    assert resp.status_code == 201
    token: str = resp.json()["token"]
    return user, token


@pytest.mark.asyncio
async def test_auth_session_and_me(client: AsyncClient, db_session: AsyncSession):
    user, token = await create_user_and_auth(
        client, db_session, "Alice Auth", f"alice_{uuid.uuid4().hex[:6]}@example.com"
    )

    # 1. Unauthenticated request to /auth/me returns 401
    resp_unauth = await client.get("/api/v1/auth/me")
    assert resp_unauth.status_code == 401

    # 2. Authenticated request returns user profile
    resp_auth = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp_auth.status_code == 200
    data = resp_auth.json()
    assert data["user_id"] == str(user.id)
    assert data["user_name"] == "Alice Auth"
    assert "xp" in data


@pytest.mark.asyncio
async def test_party_lifecycle_create_join_leave_disband(
    client: AsyncClient, db_session: AsyncSession
):
    _, host_token = await create_user_and_auth(
        client, db_session, "Host Hero", f"host_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Partner Pal", f"partner_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, third_token = await create_user_and_auth(
        client, db_session, "Third Wheel", f"third_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}
    third_headers = {"Authorization": f"Bearer {third_token}"}

    # 1. Host creates party
    create_resp = await client.post(
        "/api/v1/parties",
        headers=host_headers,
        json={"nickname": "ShadowSeeker"},
    )
    assert create_resp.status_code == 201
    party_data = create_resp.json()
    party_id = party_data["id"]
    invite_token = party_data["invite_token"]
    assert invite_token is not None
    assert party_data["status"] == "open"
    assert len(party_data["members"]) == 1
    assert party_data["members"][0]["display_name"] == "ShadowSeeker"

    # 2. Check parties/me
    my_parties_resp = await client.get("/api/v1/parties/me", headers=host_headers)
    assert my_parties_resp.status_code == 200
    assert len(my_parties_resp.json()) == 1

    # 3. Partner joins with invite_token
    join_resp = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": invite_token, "nickname": "RiddleRanger"},
    )
    assert join_resp.status_code == 200
    joined_party = join_resp.json()
    assert joined_party["id"] == party_id
    assert joined_party["status"] == "active"
    assert len(joined_party["members"]) == 2

    # 4. Third user attempts to join full party -> 404/400 (invite invalidated/capacity full)
    full_join_resp = await client.post(
        "/api/v1/parties/join",
        headers=third_headers,
        json={"invite_token": invite_token, "nickname": "Intruder"},
    )
    assert full_join_resp.status_code in (400, 404)

    # 5. Non-host partner attempts to disband party -> 403
    forbidden_disband = await client.post(
        f"/api/v1/parties/{party_id}/disband", headers=partner_headers
    )
    assert forbidden_disband.status_code == 403

    # 6. Partner leaves party -> becomes open
    leave_resp = await client.post(
        f"/api/v1/parties/{party_id}/leave", headers=partner_headers
    )
    assert leave_resp.status_code == 200
    assert leave_resp.json()["status"] == "open"

    # 7. Host disbands party -> disbanded
    disband_resp = await client.post(
        f"/api/v1/parties/{party_id}/disband", headers=host_headers
    )
    assert disband_resp.status_code == 200
    assert disband_resp.json()["status"] == "disbanded"


@pytest.mark.asyncio
async def test_cooperative_quest_generation_and_clue_isolation(
    client: AsyncClient, db_session: AsyncSession
):
    _, host_token = await create_user_and_auth(
        client, db_session, "Host Arthur", f"arthur_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Partner Merlin", f"merlin_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}

    # 1. Setup active party
    party = (
        await client.post(
            "/api/v1/parties",
            headers=host_headers,
            json={"nickname": "Arthur"},
        )
    ).json()
    party_id = party["id"]
    invite_token = party["invite_token"]

    _ = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": invite_token, "nickname": "Merlin"},
    )

    # 2. Host starts cooperative quest (in simulated demo mode for predictability)
    start_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/start",
        headers=host_headers,
        json={
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "medium",
        },
    )
    print(f"DEBUG start_resp: {start_resp.status_code} {start_resp.text}")
    assert start_resp.status_code == 201
    party_quest = start_resp.json()
    assert party_quest["status"] == "active"
    assert party_quest["title"] is not None

    # Destination name must be hidden before verification!
    assert party_quest["destination_name"] is None

    # 3. Clue isolation check for Host (Slot 1)
    host_progress_resp = await client.get(
        f"/api/v1/parties/{party_id}/quest", headers=host_headers
    )
    assert host_progress_resp.status_code == 200
    host_progress = host_progress_resp.json()

    assert len(host_progress["my_clues"]) > 0
    # Host's clues have text
    for clue in host_progress["my_clues"]:
        assert clue["clue_text"] is not None
        assert clue["is_assigned_to_me"] is True

    # Partner's clue privacy: partner's clue text is NEVER sent, only count & reveal count
    assert host_progress["partner_clues_count"] > 0
    assert host_progress["partner_clues_revealed"] >= 0

    # 4. Clue isolation check for Partner (Slot 2)
    partner_progress_resp = await client.get(
        f"/api/v1/parties/{party_id}/quest", headers=partner_headers
    )
    assert partner_progress_resp.status_code == 200
    partner_progress = partner_progress_resp.json()

    assert len(partner_progress["my_clues"]) > 0
    for clue in partner_progress["my_clues"]:
        assert clue["clue_text"] is not None
        assert clue["is_assigned_to_me"] is True

    assert partner_progress["partner_clues_count"] > 0

    # 5. Unlock assigned clue
    first_clue = host_progress["my_clues"][0]
    unlock_resp = await client.post(
        f"/api/v1/parties/{party_id}/clues/{first_clue['id']}/unlock",
        headers=host_headers,
    )
    assert unlock_resp.status_code == 200
    unlocked_state = unlock_resp.json()
    unlocked_clue = next(c for c in unlocked_state["my_clues"] if c["id"] == first_clue["id"])
    assert unlocked_clue["is_revealed"] is True


@pytest.mark.asyncio
async def test_cooperative_verification_and_xp(
    client: AsyncClient, db_session: AsyncSession
):
    _, host_token = await create_user_and_auth(
        client, db_session, "Host Hero", f"hhero_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Partner Peer", f"ppeer_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}

    # Setup party and quest
    party = (
        await client.post(
            "/api/v1/parties",
            headers=host_headers,
            json={"nickname": "Hero"},
        )
    ).json()
    party_id = party["id"]

    _ = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": party["invite_token"], "nickname": "Peer"},
    )

    _ = await client.post(
        f"/api/v1/parties/{party_id}/quest/start",
        headers=host_headers,
        json={"available_minutes": 15, "explorer_type": "mystery", "difficulty": "easy"},
    )

    # Demo target coords in demo service is Library Courtyard (37.779260, -122.416040, answer: 'owl')
    target_lat, target_lng = 37.779260, -122.416040

    # 1. Verification fails if explorer is too far (> 150m)
    far_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=host_headers,
        json={
            "latitude": 37.7749,  # Far away
            "longitude": -122.4194,
            "observation_answer": "owl",
        },
    )
    assert far_resp.status_code == 400
    assert "proximity" in far_resp.json()["detail"].lower() or "landmark" in far_resp.json()["detail"].lower()

    # 2. Host verifies with close coordinates
    verify_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=host_headers,
        json={
            "latitude": target_lat + 0.0001,
            "longitude": target_lng + 0.0001,
            "observation_answer": "owl",
        },
    )
    assert verify_resp.status_code == 200
    vdata = verify_resp.json()
    assert vdata["success"] is True
    assert vdata["my_verified"] is True
    # Partner not verified yet, so quest not completed yet
    assert vdata["partner_verified"] is False
    assert vdata["quest_completed"] is False

    # 3. Check progress: host verified, partner still in_progress
    progress_resp = await client.get(
        f"/api/v1/parties/{party_id}/quest", headers=host_headers
    )
    prog = progress_resp.json()
    assert prog["my_verified"] is True
    assert prog["partner_verified"] is False
    assert prog["status"] == "active"

    # 4. Partner verifies with close coordinates
    p_verify_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=partner_headers,
        json={
            "latitude": target_lat + 0.0002,
            "longitude": target_lng + 0.0001,
            "observation_answer": "  OWL  ",
        },
    )
    assert p_verify_resp.status_code == 200
    pvdata = p_verify_resp.json()
    assert pvdata["success"] is True
    assert pvdata["my_verified"] is True
    assert pvdata["partner_verified"] is True
    assert pvdata["quest_completed"] is True
    assert pvdata["destination_name"] is not None  # Now revealed!

    # 5. Check progress after completion
    final_prog = (
        await client.get(
            f"/api/v1/parties/{party_id}/quest", headers=partner_headers
        )
    ).json()
    assert final_prog["status"] == "completed"
    assert final_prog["destination_name"] is not None

    # 6. Duplicate verification attempt returns conflict / no extra XP
    repeat_verify = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=host_headers,
        json={
            "latitude": target_lat,
            "longitude": target_lng,
            "observation_answer": "owl",
        },
    )
    assert repeat_verify.status_code == 409


@pytest.mark.asyncio
async def test_mutual_identity_reveal_consent(
    client: AsyncClient, db_session: AsyncSession
):
    _, host_token = await create_user_and_auth(
        client, db_session, "Alice Secret", f"alice_sec_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Bob Incognito", f"bob_inc_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}

    party = (
        await client.post(
            "/api/v1/parties",
            headers=host_headers,
            json={"nickname": "MysticFox"},
        )
    ).json()
    party_id = party["id"]

    _ = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": party["invite_token"], "nickname": "ShadowWolf"},
    )

    # 1. Initially, partner's real name is hidden
    p_info = (await client.get(f"/api/v1/parties/{party_id}", headers=host_headers)).json()
    partner_member = next(m for m in p_info["members"] if m["display_name"] == "ShadowWolf")
    assert partner_member["is_real_name_revealed"] is False

    # 2. Host grants consent alone -> still not revealed (not mutual)
    _ = await client.post(
        f"/api/v1/parties/{party_id}/consent",
        headers=host_headers,
        json={"consent": True},
    )
    p_info2 = (await client.get(f"/api/v1/parties/{party_id}", headers=host_headers)).json()
    partner_member2 = next(m for m in p_info2["members"] if m["display_name"] == "ShadowWolf")
    assert partner_member2["is_real_name_revealed"] is False

    # 3. Partner also grants consent -> MUTUAL! Both real names revealed
    _ = await client.post(
        f"/api/v1/parties/{party_id}/consent",
        headers=partner_headers,
        json={"consent": True},
    )
    p_info3 = (await client.get(f"/api/v1/parties/{party_id}", headers=host_headers)).json()
    partner_member_revealed = next(
        m for m in p_info3["members"] if m["display_name"] == "Bob Incognito"
    )
    assert partner_member_revealed["is_real_name_revealed"] is True

    # Host's own view from Partner's side also sees Alice Secret
    p_info_from_partner = (
        await client.get(f"/api/v1/parties/{party_id}", headers=partner_headers)
    ).json()
    host_member_revealed = next(
        m for m in p_info_from_partner["members"] if m["display_name"] == "Alice Secret"
    )
    assert host_member_revealed["is_real_name_revealed"] is True

    # 4. Host revokes consent -> mutual broken -> real names hidden again
    _ = await client.post(
        f"/api/v1/parties/{party_id}/consent",
        headers=host_headers,
        json={"consent": False},
    )
    p_info4 = (await client.get(f"/api/v1/parties/{party_id}", headers=partner_headers)).json()
    host_member_hidden = next(
        m for m in p_info4["members"] if m["display_name"] == "MysticFox"
    )
    assert host_member_hidden["is_real_name_revealed"] is False
