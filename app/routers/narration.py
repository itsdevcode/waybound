import logging
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.rate_limit import (
    get_client_ip,
    narration_global_daily_limiter,
    narration_rate_limiter,
    narration_user_daily_limiter,
)
from app.db.session import get_session
from app.models.party import PartyMembership, PartyQuest, SplitClue
from app.models.quest import Quest
from app.models.user import User
from app.schemas.quest import NarrationConfigResponse
from app.services.elevenlabs import ElevenLabsError, elevenlabs_service


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/narration",
    tags=["Narration & Voice Game Master"],
)


def get_allowed_voice_ids() -> set[str]:
    configured = {v.strip() for v in settings.elevenlabs_allowed_voice_ids.split(",") if v.strip()}
    if settings.elevenlabs_voice_id:
        configured.add(settings.elevenlabs_voice_id.strip())
    return configured


def get_allowed_model_ids() -> set[str]:
    configured = {m.strip() for m in settings.elevenlabs_allowed_model_ids.split(",") if m.strip()}
    if settings.elevenlabs_model_id:
        configured.add(settings.elevenlabs_model_id.strip())
    return configured


def sanitize_narration_content(text: str, destination_name: str | None, is_completed: bool) -> str:
    """
    Sanitizes narration content to enforce destination secrecy and eliminate coordinate leakage.
    Pre-arrival story and clues must never speak the hidden landmark name or exact GPS coordinates.
    """
    sanitized = text.strip()
    if not is_completed and destination_name and destination_name.strip():
        # Case-insensitive redaction of destination landmark name if accidentally embedded
        pattern = re.compile(re.escape(destination_name.strip()), re.IGNORECASE)
        sanitized = pattern.sub("the sealed landmark", sanitized)

    # Redact raw GPS coordinates (e.g. 37.774929, -122.419416)
    coord_pattern = re.compile(r"-?\b\d{1,3}\.\d{4,}\b")
    sanitized = coord_pattern.sub("[hidden coordinates]", sanitized)
    return sanitized


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
    # 1. Rate limiting & persistent daily credit caps
    client_ip = get_client_ip(http_request)
    await narration_rate_limiter.check(f"narration_ip:{client_ip}", db=db)
    await narration_rate_limiter.check(f"narration_user:{current_user.id}", db=db)
    await narration_user_daily_limiter.check(f"narration_daily_user:{current_user.id}", db=db)
    await narration_global_daily_limiter.check("narration_daily_global", db=db)

    # 2. Check server-side ElevenLabs configuration
    if not elevenlabs_service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ElevenLabs narration is disabled or unconfigured on the server.",
        )

    # 3. Server-side allowlist validation for voice_id and model_id
    if voice_id is not None:
        clean_voice_id = voice_id.strip()
        if clean_voice_id not in get_allowed_voice_ids():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Voice ID '{voice_id}' is not in the server-side allowed voice list.",
            )
    else:
        clean_voice_id = settings.elevenlabs_voice_id

    if model_id is not None:
        clean_model_id = model_id.strip()
        if clean_model_id not in get_allowed_model_ids():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Model ID '{model_id}' is not in the server-side allowed model list.",
            )
    else:
        clean_model_id = settings.elevenlabs_model_id

    # 4. Retrieve Quest
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

    # 5. Check if quest is associated with a cooperative fellowship
    pq_stmt = select(PartyQuest).where(PartyQuest.quest_id == quest_id)
    party_quest = (await db.execute(pq_stmt)).scalars().first()

    party_membership: PartyMembership | None = None
    if party_quest:
        # BOTH host and guest must resolve an active PartyMembership record
        m_stmt = (
            select(PartyMembership)
            .where(
                PartyMembership.party_id == party_quest.party_id,
                PartyMembership.user_id == current_user.id,
                PartyMembership.status == "active",
            )
        )
        party_membership = (await db.execute(m_stmt)).scalars().first()
        if not party_membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not an active member of this cooperative quest fellowship.",
            )
    else:
        # Solo quest: user must be the quest owner
        if quest.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to access narration for this quest.",
            )

    # 6. Resolve strictly authorized narration text
    narration_text: str = ""
    auth_scope = f"user:{current_user.id}::quest:{quest_id}::{content_type}"
    is_completed = quest.status == "completed"

    if content_type == "story":
        # Story description is public to authorized members of the quest
        narration_text = sanitize_narration_content(
            quest.description,
            destination_name=quest.destination_name,
            is_completed=is_completed,
        )

    elif content_type == "clue":
        if not step_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="step_id parameter is required when content_type is 'clue'.",
            )

        if party_quest:
            # Cooperative quest uses SplitClues
            sc_stmt = (
                select(SplitClue)
                .where(
                    SplitClue.party_quest_id == party_quest.id,
                    SplitClue.id == step_id,
                )
            )
            split_clue = (await db.execute(sc_stmt)).scalars().first()
            if not split_clue:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Clue not found for this cooperative quest.",
                )

            # Strict privacy check for BOTH host and guest:
            # An explorer can NEVER narrate another member's private clue, even if revealed!
            if not party_membership or split_clue.assigned_slot != party_membership.slot_number:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate another member's private clue.",
                )

            if not split_clue.is_revealed:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate locked clue.",
                )

            narration_text = sanitize_narration_content(
                split_clue.clue_text,
                destination_name=quest.destination_name,
                is_completed=is_completed,
            )
            auth_scope += f"::split_clue:{split_clue.id}"

        else:
            # Solo quest uses QuestStep
            step = next((s for s in quest.steps if s.id == step_id), None)
            if not step:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Clue not found for this quest.",
                )

            if not step.is_unlocked:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot narrate a locked clue. Unlock the clue through gameplay first.",
                )

            narration_text = sanitize_narration_content(
                step.clue,
                destination_name=quest.destination_name,
                is_completed=is_completed,
            )
            auth_scope += f"::step:{step.id}"

    elif content_type == "completion":
        # Only allow completion narration if the quest is actually completed!
        if not is_completed:
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

    # 7. Synthesize audio via ElevenLabsService (handles LRU cache, request coalescing, and timeouts)
    try:
        audio_bytes = await elevenlabs_service.generate_speech(
            text=narration_text,
            voice_id=clean_voice_id,
            model_id=clean_model_id,
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
