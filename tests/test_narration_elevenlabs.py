import asyncio
import uuid
from unittest.mock import patch

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import (
    narration_rate_limiter,
    narration_user_daily_limiter,
)
from app.models.party import Party, PartyMembership, PartyQuest, SplitClue
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.models.user import User
from app.services.elevenlabs import elevenlabs_service
from tests.test_social_party import create_user_and_auth



@pytest.fixture(autouse=True)
def setup_elevenlabs_config():
    original_enabled = settings.elevenlabs_enabled
    original_key = settings.elevenlabs_api_key
    settings.elevenlabs_enabled = True
    settings.elevenlabs_api_key = "test_elevenlabs_key_12345"
    elevenlabs_service.api_key = "test_elevenlabs_key_12345"
    elevenlabs_service.cache.clear()
    yield
    settings.elevenlabs_enabled = original_enabled
    settings.elevenlabs_api_key = original_key
    elevenlabs_service.api_key = original_key
    elevenlabs_service.cache.clear()


async def create_quest_with_steps(
    db: AsyncSession,
    user: User,
    status: str = "active",
) -> tuple[Quest, list[QuestStep]]:
    quest = Quest(
        user_id=user.id,
        title="Sanctuary of Whispers",
        description="Follow the path of lanterns to the sunken atrium.",
        difficulty="medium",
        estimated_minutes=30,
        reward_xp=50,
        status=status,
        destination_name="Secret Sanctuary Atrium",
        destination_latitude=37.7749,
        destination_longitude=-122.4194,
        verification_prompt="Look at the stone sundial.",
        verification_answer="shadow",
    )
    db.add(quest)
    await db.flush()

    step1 = QuestStep(
        quest_id=quest.id,
        step_order=1,
        clue="Look behind the ivy wall for the bronze lantern.",
        is_unlocked=True,
    )
    step2 = QuestStep(
        quest_id=quest.id,
        step_order=2,
        clue="Count seven paces toward the iron gate.",
        is_unlocked=False,  # Locked clue!
    )
    db.add(step1)
    db.add(step2)
    await db.commit()
    return quest, [step1, step2]


async def create_cooperative_party_quest(
    db: AsyncSession,
    host: User,
    guest: User,
) -> tuple[Party, PartyQuest, Quest, SplitClue, SplitClue]:
    """
    Sets up a 2-player cooperative party with split clues:
    - Host is slot 1
    - Guest is slot 2
    - Clue 1 assigned to Slot 1 (Host perspective)
    - Clue 2 assigned to Slot 2 (Guest perspective)
    """
    party = Party(
        host_id=host.id,
        name="Coop Fellowship",
        status="active",
    )
    db.add(party)
    await db.flush()

    mem_host = PartyMembership(
        party_id=party.id,
        user_id=host.id,
        role="host",
        slot_number=1,
        nickname="HostSeeker",
        status="active",
    )
    mem_guest = PartyMembership(
        party_id=party.id,
        user_id=guest.id,
        role="member",
        slot_number=2,
        nickname="GuestScholar",
        status="active",
    )

    db.add(mem_host)
    db.add(mem_guest)

    quest = Quest(
        user_id=host.id,
        title="Fellowship of the Sunken Spire",
        description="Two fragments of an ancient key lie separated by the river.",
        difficulty="medium",
        estimated_minutes=30,
        reward_xp=60,
        status="active",
        destination_name="Sunken Spire",
        destination_latitude=37.7792,
        destination_longitude=-122.4160,
        verification_prompt="What symbol is engraved on the arch?",
        verification_answer="owl",
    )
    db.add(quest)
    await db.flush()

    pq = PartyQuest(
        party_id=party.id,
        quest_id=quest.id,
        status="active",
    )
    db.add(pq)
    await db.flush()

    clue_host = SplitClue(
        party_quest_id=pq.id,
        assigned_slot=1,
        step_order=1,
        clue_title="Fragment of the Northern Gate",
        clue_text="Look at the gargoyle facing north with the iron shield.",
        is_revealed=True,
    )
    clue_guest = SplitClue(
        party_quest_id=pq.id,
        assigned_slot=2,
        step_order=1,
        clue_title="Fragment of the Southern Basin",
        clue_text="Seek the stone chalice nestled beside the southern cypress.",
        is_revealed=True,
    )
    db.add(clue_host)
    db.add(clue_guest)
    await db.commit()

    return party, pq, quest, clue_host, clue_guest


@pytest.mark.asyncio
async def test_narration_config_endpoint(client: AsyncClient):
    resp = await client.get("/api/v1/narration/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is True
    assert "default_voice_id" in data
    assert "default_model_id" in data
    assert "api_key" not in data


@pytest.mark.asyncio
async def test_narration_requires_authentication(client: AsyncClient):
    resp = await client.get(
        "/api/v1/narration/synthesize",
        params={"quest_id": str(uuid.uuid4()), "content_type": "story"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_synthesize_story_narration_success_and_caching(
    client: AsyncClient, db_session: AsyncSession
):
    user, token = await create_user_and_auth(
        client, db_session, "Voice Explorer", f"voice_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    dummy_mp3 = b"ID3_MOCK_MP3_AUDIO_BYTES_TEST"

    with patch("httpx.AsyncClient.post") as mock_http_post:
        mock_http_post.return_value = Response(
            status_code=200,
            content=dummy_mp3,
            headers={"Content-Type": "audio/mpeg"},
        )

        resp1 = await client.get(
            "/api/v1/narration/synthesize",
            params={"quest_id": str(quest.id), "content_type": "story"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp1.status_code == 200
        assert resp1.headers["content-type"] == "audio/mpeg"
        assert resp1.content == dummy_mp3
        assert mock_http_post.call_count == 1

        # Second request -> cache hit
        resp2 = await client.get(
            "/api/v1/narration/synthesize",
            params={"quest_id": str(quest.id), "content_type": "story"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
        assert resp2.content == dummy_mp3
        assert mock_http_post.call_count == 1


@pytest.mark.asyncio
async def test_cooperative_cross_slot_narration_strictly_forbidden(
    client: AsyncClient, db_session: AsyncSession
):
    """
    CRITICAL SECURITY & PRIVACY REGRESSION TEST:
    1. Host (slot 1) can narrate their own unlocked clue (slot 1).
    2. Host (quest owner) CANNOT narrate Guest's clue (slot 2), even if revealed!
    3. Guest (slot 2) can narrate their own unlocked clue (slot 2).
    4. Guest CANNOT narrate Host's clue (slot 1), even if revealed!
    """
    host, host_token = await create_user_and_auth(
        client, db_session, "Party Host", f"host_{uuid.uuid4().hex[:6]}@example.com"
    )
    guest, guest_token = await create_user_and_auth(
        client, db_session, "Party Guest", f"guest_{uuid.uuid4().hex[:6]}@example.com"
    )
    _, _, quest, clue_host, clue_guest = await create_cooperative_party_quest(
        db_session, host, guest
    )

    with patch("httpx.AsyncClient.post") as mock_http_post:
        mock_http_post.return_value = Response(
            status_code=200,
            content=b"COOP_AUDIO_BYTES",
            headers={"Content-Type": "audio/mpeg"},
        )

        # 1. Host narrates host clue (Slot 1 -> Slot 1) -> SUCCESS
        r1 = await client.get(
            "/api/v1/narration/synthesize",
            params={
                "quest_id": str(quest.id),
                "content_type": "clue",
                "step_id": str(clue_host.id),
            },
            headers={"Authorization": f"Bearer {host_token}"},
        )
        assert r1.status_code == 200

        # 2. Host attempts to narrate guest clue (Slot 1 -> Slot 2) -> 403 FORBIDDEN!
        r2 = await client.get(
            "/api/v1/narration/synthesize",
            params={
                "quest_id": str(quest.id),
                "content_type": "clue",
                "step_id": str(clue_guest.id),
            },
            headers={"Authorization": f"Bearer {host_token}"},
        )
        assert r2.status_code == 403
        assert "private clue" in r2.json()["detail"].lower()

        # 3. Guest narrates guest clue (Slot 2 -> Slot 2) -> SUCCESS
        r3 = await client.get(
            "/api/v1/narration/synthesize",
            params={
                "quest_id": str(quest.id),
                "content_type": "clue",
                "step_id": str(clue_guest.id),
            },
            headers={"Authorization": f"Bearer {guest_token}"},
        )
        assert r3.status_code == 200

        # 4. Guest attempts to narrate host clue (Slot 2 -> Slot 1) -> 403 FORBIDDEN!
        r4 = await client.get(
            "/api/v1/narration/synthesize",
            params={
                "quest_id": str(quest.id),
                "content_type": "clue",
                "step_id": str(clue_host.id),
            },
            headers={"Authorization": f"Bearer {guest_token}"},
        )
        assert r4.status_code == 403
        assert "private clue" in r4.json()["detail"].lower()


@pytest.mark.asyncio
async def test_voice_and_model_allowlist_enforcement(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Arbitrary client-provided voice_id or model_id overrides outside the allowlist are rejected with 400.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Allowlist Explorer", f"al_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    # Disallowed voice_id
    resp_bad_voice = await client.get(
        "/api/v1/narration/synthesize",
        params={
            "quest_id": str(quest.id),
            "content_type": "story",
            "voice_id": "malicious_unregistered_voice_9999",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp_bad_voice.status_code == 400
    assert "not in the server-side allowed voice list" in resp_bad_voice.json()["detail"]

    # Disallowed model_id
    resp_bad_model = await client.get(
        "/api/v1/narration/synthesize",
        params={
            "quest_id": str(quest.id),
            "content_type": "story",
            "model_id": "unauthorized_expensive_model_v9",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp_bad_model.status_code == 400
    assert "not in the server-side allowed model list" in resp_bad_model.json()["detail"]


@pytest.mark.asyncio
async def test_request_coalescing_prevents_simultaneous_duplicate_paid_calls():
    """
    Simultaneous identical cache misses are coalesced into a single ElevenLabs API call.
    """
    elevenlabs_service.cache.clear()
    call_count = 0

    async def slow_mock_fetch(*_args: object, **_kwargs: object) -> bytes:
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)  # Simulate network latency
        return b"COALESCED_AUDIO_RESULT"

    with patch.object(elevenlabs_service, "_do_fetch_speech", side_effect=slow_mock_fetch):
        # Fire 5 concurrent requests with identical text
        tasks = [
            elevenlabs_service.generate_speech(
                text="The ancient spire glows under the moonlight.",
                voice_id=settings.elevenlabs_voice_id,
                model_id=settings.elevenlabs_model_id,
                auth_scope="test_coalesce_scope",
            )
            for _ in range(5)
        ]

        results = await asyncio.gather(*tasks)

        # All 5 callers get the exact same audio bytes
        for r in results:
            assert r == b"COALESCED_AUDIO_RESULT"

        # Exactly ONE external call was made!
        assert call_count == 1


@pytest.mark.asyncio
async def test_persistent_daily_usage_limits(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Exceeding daily per-user credit cap triggers 429 with informative credit guidance.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Daily Explorer", f"daily_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    # Reset keys
    await narration_rate_limiter.reset(f"narration_user:{user.id}", db=db_session)
    await narration_user_daily_limiter.reset(f"narration_daily_user:{user.id}", db=db_session)

    # Set temporary low daily limit for testing
    original_daily = settings.elevenlabs_user_daily_limit
    settings.elevenlabs_user_daily_limit = 2
    setattr(narration_user_daily_limiter, "limit", 2)

    try:
        with patch("httpx.AsyncClient.post") as mock_http_post:
            mock_http_post.return_value = Response(
                status_code=200, content=b"AUDIO", headers={"Content-Type": "audio/mpeg"}
            )

            # Request 1 -> 200
            r1 = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r1.status_code == 200

            # Request 2 -> 200
            r2 = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r2.status_code == 200

            # Request 3 -> Exceeds daily limit -> 429
            r3 = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r3.status_code == 429
            assert "credit limit reached" in str(r3.json()["detail"]).lower()
    finally:
        settings.elevenlabs_user_daily_limit = original_daily
        setattr(narration_user_daily_limiter, "limit", original_daily)


@pytest.mark.asyncio
async def test_privacy_scrubs_destination_name_and_coordinates_from_pre_arrival_narration(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Destination secrecy test:
    If quest description contains destination name or raw GPS coordinates,
    they are scrubbed before reaching ElevenLabs TTS.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Secrecy Explorer", f"sec_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest = Quest(
        user_id=user.id,
        title="Hidden Observatory Quest",
        description="Head to the Secret Observatory Peak near coordinates 37.774929, -122.419416 to find the glass dome.",
        difficulty="easy",
        estimated_minutes=15,
        reward_xp=30,
        status="active",
        destination_name="Secret Observatory Peak",
        destination_latitude=37.7749,
        destination_longitude=-122.4194,
        verification_prompt="Look at the glass dome.",
        verification_answer="glass",
    )

    db_session.add(quest)
    await db_session.commit()

    captured_text: str | None = None

    async def mock_generate_speech(
        text: str,
        *_args: object,
        **_kwargs: object,
    ) -> bytes:
        nonlocal captured_text
        captured_text = text
        return b"SANITIZED_AUDIO"


    with patch.object(elevenlabs_service, "generate_speech", side_effect=mock_generate_speech):
        resp = await client.get(
            "/api/v1/narration/synthesize",
            params={"quest_id": str(quest.id), "content_type": "story"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert captured_text is not None

        # Destination name must be redacted
        assert "Secret Observatory Peak" not in captured_text
        assert "the sealed landmark" in captured_text

        # Raw GPS coordinates must be redacted
        assert "37.774929" not in captured_text
        assert "-122.419416" not in captured_text
        assert "[hidden coordinates]" in captured_text


@pytest.mark.asyncio
async def test_locked_clue_cannot_be_narrated(
    client: AsyncClient, db_session: AsyncSession
):
    user, token = await create_user_and_auth(
        client, db_session, "Clue Explorer", f"clue_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, steps = await create_quest_with_steps(db_session, user)
    locked_step = steps[1]  # step 2 is locked

    resp = await client.get(
        "/api/v1/narration/synthesize",
        params={
            "quest_id": str(quest.id),
            "content_type": "clue",
            "step_id": str(locked_step.id),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert "locked clue" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_completion_narration_forbidden_before_completion(
    client: AsyncClient, db_session: AsyncSession
):
    user, token = await create_user_and_auth(
        client, db_session, "Early Explorer", f"early_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user, status="active")

    resp = await client.get(
        "/api/v1/narration/synthesize",
        params={"quest_id": str(quest.id), "content_type": "completion"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert "before the quest is successfully verified" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_elevenlabs_provider_failure_returns_graceful_error(
    client: AsyncClient, db_session: AsyncSession
):
    user, token = await create_user_and_auth(
        client, db_session, "Fail Explorer", f"fail_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    with patch("httpx.AsyncClient.post") as mock_http_post:
        mock_http_post.return_value = Response(
            status_code=500,
            content=b"Internal ElevenLabs Error",
        )

        resp = await client.get(
            "/api/v1/narration/synthesize",
            params={"quest_id": str(quest.id), "content_type": "story"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 502
        assert "failed" in resp.json()["detail"].lower()
