import asyncio
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, settings
from app.core.rate_limit import auth_rate_limiter
from app.models.party import Party, PartyQuest
from app.models.profile import Profile
from app.models.quest import Quest
from app.models.user import User


async def create_user_and_auth(
    client: AsyncClient, db_session: AsyncSession, name: str, email: str
) -> tuple[User, str]:
    test_ip = f"10.99.{(uuid.uuid4().int % 200) + 1}.{(uuid.uuid4().int % 200) + 1}"
    headers = {"X-Forwarded-For": test_ip}

    # Request proof-of-identity OTP
    req_resp = await client.post("/api/v1/auth/otp/request", json={"email": email}, headers=headers)
    assert req_resp.status_code == 200
    simulated_code = req_resp.json()["simulated_code"]
    assert simulated_code is not None

    # Verify OTP and obtain verified session Bearer token
    verify_resp = await client.post(
        "/api/v1/auth/otp/verify", json={"email": email, "code": simulated_code}, headers=headers
    )
    assert verify_resp.status_code == 200
    token: str = verify_resp.json()["token"]
    user_id = uuid.UUID(verify_resp.json()["user_id"])

    user_stmt = select(User).options(selectinload(User.profile)).where(User.id == user_id)
    user = (await db_session.execute(user_stmt)).scalars().first()
    assert user is not None
    user.name = name
    await db_session.commit()
    return user, token


@pytest.mark.asyncio
async def test_auth_otp_and_me(client: AsyncClient, db_session: AsyncSession):
    email = f"alice_{uuid.uuid4().hex[:6]}@example.com"
    user, token = await create_user_and_auth(client, db_session, "Alice Auth", email)

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
    assert data["email"] == email


@pytest.mark.asyncio
async def test_arbitrary_user_id_session_creation_forbidden(
    client: AsyncClient, db_session: AsyncSession
):
    # Create legitimate user
    victim_user, _ = await create_user_and_auth(
        client, db_session, "Victim Explorer", f"victim_{uuid.uuid4().hex[:6]}@example.com"
    )

    # 1. Old unauthenticated session endpoint is removed
    old_endpoint_resp = await client.post(
        "/api/v1/auth/session", json={"user_id": str(victim_user.id)}
    )
    assert old_endpoint_resp.status_code in (404, 405)

    # 2. Attacker passing victim's UUID to demo endpoint is rejected with 403 Forbidden
    demo_hijack_resp = await client.post(
        "/api/v1/auth/demo-session", json={"user_id": str(victim_user.id)}
    )
    assert demo_hijack_resp.status_code == 403
    assert "seeded demo explorer identity" in demo_hijack_resp.json()["detail"]

    # 3. Attacker guessing OTP with wrong code is rejected
    wrong_otp_resp = await client.post(
        "/api/v1/auth/otp/verify",
        json={"email": victim_user.email, "code": "000000"},
    )
    assert wrong_otp_resp.status_code == 400

    # 4. Forged Bearer token returns 401 Unauthorized
    forged_resp = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer forged_opaque_token_xyz"}
    )
    assert forged_resp.status_code == 401


@pytest.mark.asyncio
async def test_demo_auth_disabled_in_production_and_config_validation(client: AsyncClient):
    original_env = settings.environment
    original_demo_flag = settings.allow_demo_auth

    try:
        # Mock production environment
        settings.environment = "production"
        settings.allow_demo_auth = False

        # Demo session creation must fail with 403 in production
        prod_resp = await client.post("/api/v1/auth/demo-session", json={})
        assert prod_resp.status_code == 403
        assert "disabled in production" in prod_resp.json()["detail"]

        # Production config validation: rejecting insecure default secrets
        with pytest.raises(ValueError, match="Insecure or missing AUTH_SECRET"):
            Settings(
                environment="production",
                auth_secret="waybound_dev_insecure_auth_secret_must_change_in_production",
            )
    finally:
        settings.environment = original_env
        settings.allow_demo_auth = original_demo_flag


@pytest.mark.asyncio
async def test_session_logout_and_revocation(client: AsyncClient, db_session: AsyncSession):
    _, token = await create_user_and_auth(
        client, db_session, "Logout User", f"logout_{uuid.uuid4().hex[:6]}@example.com"
    )
    headers = {"Authorization": f"Bearer {token}"}

    # Verify session is initially active
    check1 = await client.get("/api/v1/auth/me", headers=headers)
    assert check1.status_code == 200

    # Revoke session via logout
    logout_resp = await client.post("/api/v1/auth/logout", headers=headers)
    assert logout_resp.status_code == 200
    assert logout_resp.json()["success"] is True

    # Revoked token cannot be reused
    check2 = await client.get("/api/v1/auth/me", headers=headers)
    assert check2.status_code == 401
    assert "revoked" in check2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_auth_rate_limiting(client: AsyncClient):
    # Reset limiter for test IP
    await auth_rate_limiter.reset("otp_req:127.0.0.1")
    email = f"rate_limit_{uuid.uuid4().hex[:6]}@example.com"

    # Rapid requests to trigger rate limit (limit is 10/min)
    responses = []
    for _ in range(12):
        r = await client.post("/api/v1/auth/otp/request", json={"email": email})
        responses.append(r.status_code)

    assert 429 in responses
    await auth_rate_limiter.reset("otp_req:127.0.0.1")


@pytest.mark.asyncio
async def test_concurrent_party_join_capacity(client: AsyncClient, db_session: AsyncSession):
    _, host_token = await create_user_and_auth(
        client, db_session, "Host Concur", f"c_host_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, p1_token = await create_user_and_auth(
        client, db_session, "Peer One", f"c_p1_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, p2_token = await create_user_and_auth(
        client, db_session, "Peer Two", f"c_p2_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    p1_headers = {"Authorization": f"Bearer {p1_token}"}
    p2_headers = {"Authorization": f"Bearer {p2_token}"}

    # Host creates open party
    create_resp = await client.post(
        "/api/v1/parties", headers=host_headers, json={"nickname": "HostC"}
    )
    assert create_resp.status_code == 201
    party_id = create_resp.json()["id"]
    invite_token = create_resp.json()["invite_token"]

    # Two users attempt to join concurrently in separate requests
    async def join_p1():
        return await client.post(
            "/api/v1/parties/join",
            headers=p1_headers,
            json={"invite_token": invite_token, "nickname": "Peer1"},
        )

    async def join_p2():
        return await client.post(
            "/api/v1/parties/join",
            headers=p2_headers,
            json={"invite_token": invite_token, "nickname": "Peer2"},
        )

    res1, res2 = await asyncio.gather(join_p1(), join_p2())
    statuses = [res1.status_code, res2.status_code]

    # Exactly one user succeeds (200), other user fails with 400, 404, or 409
    assert 200 in statuses
    assert (400 in statuses) or (404 in statuses) or (409 in statuses)

    # Verify party has exactly 2 members
    party_info = (await client.get(f"/api/v1/parties/{party_id}", headers=host_headers)).json()
    assert len(party_info["members"]) == 2


@pytest.mark.asyncio
async def test_concurrent_quest_start_reservation(client: AsyncClient, db_session: AsyncSession):
    _, host_token = await create_user_and_auth(
        client, db_session, "Host Res", f"h_res_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Peer Res", f"p_res_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}

    # Setup active party
    party = (
        await client.post(
            "/api/v1/parties", headers=host_headers, json={"nickname": "HostRes"}
        )
    ).json()
    party_id = party["id"]

    _ = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": party["invite_token"], "nickname": "PeerRes"},
    )

    # Two concurrent quest start attempts on the same party
    async def start_attempt_1():
        return await client.post(
            f"/api/v1/parties/{party_id}/quest/start",
            headers=host_headers,
            json={"available_minutes": 15, "explorer_type": "mystery", "difficulty": "easy"},
        )

    async def start_attempt_2():
        return await client.post(
            f"/api/v1/parties/{party_id}/quest/start",
            headers=host_headers,
            json={"available_minutes": 15, "explorer_type": "mystery", "difficulty": "easy"},
        )

    r1, r2 = await asyncio.gather(start_attempt_1(), start_attempt_2())
    statuses = [r1.status_code, r2.status_code]

    # Exactly one succeeds (201), the other is rejected with 409 Conflict
    assert 201 in statuses
    assert 409 in statuses


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

    # 4. Third user attempts to join full party -> 400 / 404 / 409
    full_join_resp = await client.post(
        "/api/v1/parties/join",
        headers=third_headers,
        json={"invite_token": invite_token, "nickname": "Intruder"},
    )
    assert full_join_resp.status_code in (400, 404, 409)

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

    # 2. Host starts cooperative quest
    start_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/start",
        headers=host_headers,
        json={
            "available_minutes": 30,
            "explorer_type": "mystery",
            "difficulty": "medium",
        },
    )
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
    for clue in host_progress["my_clues"]:
        assert clue["clue_text"] is not None
        assert clue["is_assigned_to_me"] is True

    # Partner's clue privacy: partner clue text is NEVER returned
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

    target_lat, target_lng = 37.779260, -122.416040

    # 1. Verification fails if explorer is too far (> 100m)
    far_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=host_headers,
        json={
            "latitude": 37.7749,
            "longitude": -122.4194,
            "observation_answer": "owl",
        },
    )
    assert far_resp.status_code == 400

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
    assert vdata["partner_verified"] is False
    assert vdata["quest_completed"] is False

    # 3. Partner verifies with close coordinates
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
    assert pvdata["destination_name"] is not None

    # 4. Duplicate verification attempt returns conflict / no extra XP
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
async def test_real_world_quest_awards_zero_xp(client: AsyncClient, db_session: AsyncSession):
    _, host_token = await create_user_and_auth(
        client, db_session, "Real Host", f"r_host_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, partner_token = await create_user_and_auth(
        client, db_session, "Real Peer", f"r_peer_{uuid.uuid4().hex[:6]}@example.com"
    )

    host_headers = {"Authorization": f"Bearer {host_token}"}
    partner_headers = {"Authorization": f"Bearer {partner_token}"}

    party = (
        await client.post(
            "/api/v1/parties",
            headers=host_headers,
            json={"nickname": "RealSeeker"},
        )
    ).json()
    party_id = party["id"]

    _ = await client.post(
        "/api/v1/parties/join",
        headers=partner_headers,
        json={"invite_token": party["invite_token"], "nickname": "RealPartner"},
    )

    start_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/start",
        headers=host_headers,
        json={"available_minutes": 30, "explorer_type": "mystery", "difficulty": "medium"},
    )
    assert start_resp.status_code == 201

    # Modify the quest destination name in DB to not start with [Simulated Demo]
    # simulating a real-world Google Places + Gemma quest
    pq_stmt = select(PartyQuest).options(selectinload(PartyQuest.quest)).where(PartyQuest.party_id == uuid.UUID(party_id))
    pq = (await db_session.execute(pq_stmt)).scalars().first()
    assert pq is not None
    pq.quest.destination_name = "Real World City Hall Plaza"
    await db_session.commit()

    target_lat = float(pq.quest.destination_latitude)
    target_lng = float(pq.quest.destination_longitude)
    answer = pq.quest.verification_answer

    # Both verify
    _ = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=host_headers,
        json={"latitude": target_lat, "longitude": target_lng, "observation_answer": answer},
    )
    v2_resp = await client.post(
        f"/api/v1/parties/{party_id}/quest/verify",
        headers=partner_headers,
        json={"latitude": target_lat, "longitude": target_lng, "observation_answer": answer},
    )
    assert v2_resp.status_code == 200
    v2_data = v2_resp.json()
    assert v2_data["quest_completed"] is True
    # Real-world quest MUST award exactly 0 XP
    assert v2_data["reward_xp_awarded"] == 0


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
