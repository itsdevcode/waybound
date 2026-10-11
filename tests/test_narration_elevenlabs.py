import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import narration_rate_limiter
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.models.user import User
from app.services.elevenlabs import (
    ElevenLabsError,
    NarrationCache,
    elevenlabs_service,
)
from tests.test_social_party import create_user_and_auth


@pytest.fixture(autouse=True)
def setup_elevenlabs_config():
    original_enabled = settings.elevenlabs_enabled
    original_key = settings.elevenlabs_api_key
    settings.elevenlabs_enabled = True
    settings.elevenlabs_api_key = "test_elevenlabs_key_12345"
    elevenlabs_service.api_key = "test_elevenlabs_key_12345"
    yield
    settings.elevenlabs_enabled = original_enabled
    settings.elevenlabs_api_key = original_key
    elevenlabs_service.api_key = original_key


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


@pytest.mark.asyncio
async def test_narration_config_endpoint(client: AsyncClient):
    """
    Config endpoint returns whether ElevenLabs is enabled without leaking secrets.
    """
    resp = await client.get("/api/v1/narration/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is True
    assert "default_voice_id" in data
    assert "default_model_id" in data
    assert "api_key" not in data  # Never expose key!


@pytest.mark.asyncio
async def test_narration_requires_authentication(client: AsyncClient):
    """
    Unauthenticated request to /narration/synthesize is rejected with 401.
    """
    resp = await client.get(
        "/api/v1/narration/synthesize",
        params={"quest_id": str(uuid.uuid4()), "content_type": "story"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_synthesize_story_narration_success_and_caching(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Authorized explorer can synthesize story audio. Subsequent identical request
    hits cache without calling ElevenLabs API.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Voice Explorer", f"voice_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    dummy_mp3 = b"ID3_MOCK_MP3_AUDIO_BYTES_TEST"

    with patch.object(
        elevenlabs_service,
        "generate_speech",
        wraps=elevenlabs_service.generate_speech,
    ) as mock_gen:
        # Mock underlying httpx response
        with patch("httpx.AsyncClient.post") as mock_http_post:
            mock_http_post.return_value = Response(
                status_code=200,
                content=dummy_mp3,
                headers={"Content-Type": "audio/mpeg"},
            )

            # First request -> calls ElevenLabs
            resp1 = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp1.status_code == 200
            assert resp1.headers["content-type"] == "audio/mpeg"
            assert resp1.content == dummy_mp3
            assert mock_http_post.call_count == 1

            # Second identical request -> served from cache!
            resp2 = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp2.status_code == 200
            assert resp2.content == dummy_mp3
            # Should not call ElevenLabs HTTP API again
            assert mock_http_post.call_count == 1


@pytest.mark.asyncio
async def test_unauthorized_explorer_cannot_access_narration(
    client: AsyncClient, db_session: AsyncSession
):
    """
    An explorer cannot synthesize narration for another user's quest.
    """
    owner, _ = await create_user_and_auth(
        client, db_session, "Quest Owner", f"owner_{uuid.uuid4().hex[:6]}@example.com"
    )
    attacker, attacker_token = await create_user_and_auth(
        client, db_session, "Attacker User", f"att_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, owner)

    resp = await client.get(
        "/api/v1/narration/synthesize",
        params={"quest_id": str(quest.id), "content_type": "story"},
        headers={"Authorization": f"Bearer {attacker_token}"},
    )
    assert resp.status_code == 403
    assert "not authorized" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_locked_clue_cannot_be_narrated(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Locked clues must never be narrated; rejected with 403 Forbidden.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Clue Explorer", f"clue_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, steps = await create_quest_with_steps(db_session, user)
    locked_step = steps[1]  # step_order 2 is locked

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
async def test_unlocked_clue_narration_success(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Unlocked clues can be narrated.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Unlocked Explorer", f"unl_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, steps = await create_quest_with_steps(db_session, user)
    unlocked_step = steps[0]

    with patch("httpx.AsyncClient.post") as mock_http_post:
        mock_http_post.return_value = Response(
            status_code=200,
            content=b"UNLOCKED_CLUE_AUDIO",
            headers={"Content-Type": "audio/mpeg"},
        )

        resp = await client.get(
            "/api/v1/narration/synthesize",
            params={
                "quest_id": str(quest.id),
                "content_type": "clue",
                "step_id": str(unlocked_step.id),
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.content == b"UNLOCKED_CLUE_AUDIO"


@pytest.mark.asyncio
async def test_completion_narration_forbidden_before_completion(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Completion narration cannot be accessed before the quest is completed
    to prevent premature leakage of the secret destination name!
    """
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
    """
    Provider failures return appropriate 502/429/504 errors so frontend can fall back to browser TTS.
    """
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


@pytest.mark.asyncio
async def test_narration_rate_limiting(client: AsyncClient, db_session: AsyncSession):
    """
    Rate limiter triggers after reaching threshold.
    """
    user, token = await create_user_and_auth(
        client, db_session, "Rate Explorer", f"rate_{uuid.uuid4().hex[:6]}@example.com"
    )
    quest, _ = await create_quest_with_steps(db_session, user)

    # Reset rate limit key
    await narration_rate_limiter.reset(f"narration_user:{user.id}", db=db_session)

    with patch("httpx.AsyncClient.post") as mock_http_post:
        mock_http_post.return_value = Response(
            status_code=200,
            content=b"AUDIO",
            headers={"Content-Type": "audio/mpeg"},
        )

        responses = []
        for _ in range(settings.elevenlabs_rate_limit_per_minute + 2):
            r = await client.get(
                "/api/v1/narration/synthesize",
                params={"quest_id": str(quest.id), "content_type": "story"},
                headers={"Authorization": f"Bearer {token}"},
            )
            responses.append(r.status_code)

        assert 429 in responses
