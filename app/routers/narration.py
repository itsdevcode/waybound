import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.rate_limit import get_client_ip, narration_rate_limiter
from app.db.session import get_session
from app.models.party import Party, PartyMembership, PartyQuest, SplitClue
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.models.user import User
from app.schemas.quest import NarrationConfigResponse
from app.services.elevenlabs import ElevenLabsError, elevenlabs_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/narration",
    tags=["Narration & Voice Game Master"],
)


@router.get(
    "/config",
    response_model=NarrationConfigResponse,
    summary="Get ElevenLabs narration availability",
    description="Returns whether ElevenLabs voice narration is enabled and its default voice/model settings.",
)
async def get_narration_config() -> NarrationConfigResponse:
    return NarrationConfigResponse(
        enabled=bool(settings.elevenlabs_enabled and settings.elevenlabs_api_key),
        default_voice_id=settings.elevenlabs_voice_id,
        default_model_id=settings.elevenlabs_model_id,
    )


@router.get(
    "/synthesize",
    summary="Synthesize authenticated quest narration audio",
    description="Synthesizes speech for an authorized, unlocked quest story, clue, or completion event using ElevenLabs.",
    responses={
        200: {
            "content": {"audio/mpeg": {}},
            "description": "MP3 audio stream of synthesized narration.",
        },
    },
)
async def synthesize_quest_narration(
    http_request: Request,
    quest_id: uuid.UUID = Query(..., description="ID of the quest"),
    content_type: str = Query(..., description="Content type: story, clue, or completion"),
    step_id: uuid.UUID | None = Query(default=None, description="Step or SplitClue ID when content_type is clue"),
    voice_id: str | None = Query(default=None, description="Optional ElevenLabs voice ID override"),
    model_id: str | None = Query(default=None, description="Optional ElevenLabs model ID override"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> Response:
    # 1. Rate limiting
    client_ip = get_client_ip(http_request)
    await narration_rate_limiter.check(f"narration_ip:{client_ip}", db=db)
    await narration_rate_limiter.check(f"narration_user:{current_user.id}", db=db)

    # 2. Check if ElevenLabs is configured and enabled
    if not elevenlabs_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ElevenLabs narration is disabled or unconfigured on the server.",
        )

    # 3. Retrieve Quest and verify user authorization
    quest_stmt = (
        select(Quest)
        .options(selectinload(Quest.steps))
        .where(Quest.id == quest_id)
    )
    quest = (await db.execute(quest_stmt)).scalars().first()

    if not quest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quest not found.",
        )

    # Check authorization: user is quest owner OR active party member of cooperative quest
    is_owner = quest.user_id == current_user.id
    party_membership: PartyMembership | None = None

    if not is_owner:
        # Check if quest belongs to an active party where current_user is a member
        pq_stmt = (
            select(PartyQuest)
            .join(Party, Party.id == PartyQuest.party_id)
            .join(PartyMembership, PartyMembership.party_id == Party.id)
            .where(
                PartyQuest.quest_id == quest_id,
                PartyMembership.user_id == current_user.id,
                PartyMembership.status == "active",
            )
        )
        party_membership_record = (await db.execute(pq_stmt)).scalars().first()
        if not party_membership_record:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to access narration for this quest.",
            )

        # Get the specific membership slot
        m_stmt = (
            select(PartyMembership)
            .where(
                PartyMembership.party_id == party_membership_record.party_id,
                PartyMembership.user_id == current_user.id,
                PartyMembership.status == "active",
            )
        )
        party_membership = (await db.execute(m_stmt)).scalars().first()

    # 4. Resolve strictly authorized narration text
    # Secrecy rules: Never narrate hidden destinations, raw coordinates, locked clues, or partner-private clues!
    narration_text: str = ""
    auth_scope = f"user:{current_user.id}::quest:{quest_id}::{content_type}"

    if content_type == "story":
        # Story description is public for the quest
        narration_text = quest.description

    elif content_type == "clue":
        if not step_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="step_id parameter is required when content_type is 'clue'.",
            )

        # Check solo QuestStep first
        step = next((s for s in quest.steps if s.id == step_id), None)
        if step:
            if not step.is_unlocked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate a locked clue. Unlock the clue through gameplay first.",
                )
            narration_text = step.clue
            auth_scope += f"::step:{step.id}"
        else:
            # Check party SplitClue
            sc_stmt = (
                select(SplitClue)
                .join(PartyQuest, PartyQuest.id == SplitClue.party_quest_id)
                .where(
                    PartyQuest.quest_id == quest_id,
                    SplitClue.id == step_id,
                )
            )
            split_clue = (await db.execute(sc_stmt)).scalars().first()
            if not split_clue:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Clue not found for this quest.",
                )

            # Slot privacy check: Explorer can only narrate clues assigned to their slot!
            if party_membership and split_clue.assigned_slot != party_membership.slot_number:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate partner's private clue.",
                )

            if not split_clue.is_revealed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate locked clue.",
                )

            narration_text = split_clue.clue_text
            auth_scope += f"::split_clue:{split_clue.id}"

    elif content_type == "completion":
        # Only allow completion narration if the quest is actually completed!
        if quest.status != "completed":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot narrate quest completion before the quest is successfully verified.",
            )
        narration_text = (
            f"Expedition accomplished! You have successfully reached {quest.destination_name} "
            f"and verified your observation. You earned {quest.reward_xp} experience points."
        )
        auth_scope += f"::completed"

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid content_type: '{content_type}'. Must be 'story', 'clue', or 'completion'.",
        )

    # 5. Synthesize audio via ElevenLabsService (handles LRU cache, input validation, and timeouts)
    try:
        audio_bytes = await elevenlabs_service.generate_speech(
            text=narration_text,
            voice_id=voice_id,
            model_id=model_id,
            auth_scope=auth_scope,
        )
    except ElevenLabsError as exc:
        logger.error("ElevenLabs synthesis error: %s", exc.message)
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception as exc:
        logger.exception("Unexpected error in ElevenLabs narration synthesis: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to synthesize voice narration audio.",
        ) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="narration_{quest_id}_{content_type}.mp3"',
        },
    )
