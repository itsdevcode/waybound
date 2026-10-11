import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.party import (
    ConsentRevealRequest,
    PartyCreateRequest,
    PartyJoinRequest,
    PartyResponse,
    PartyStartQuestRequest,
    PartyVerificationResponse,
    PartyVerifyRequest,
    SharedPartyQuestResponse,
)
from app.services.party import (
    PartyAccessForbiddenError,
    PartyConflictError,
    PartyNotFoundError,
    PartyService,
    PartyServiceError,
)
from app.services.providers.factory import create_quest_provider

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/parties",
    tags=["Parties & Mystery Partners"],
)


def get_party_service(
    session: AsyncSession = Depends(get_session),
) -> PartyService:
    try:
        provider = create_quest_provider()
    except Exception as e:
        logger.exception("Provider creation failed in party service: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error. Please contact administrator.",
        )
    return PartyService(session=session, quest_provider=provider)


def handle_party_error(e: Exception) -> HTTPException:
    if isinstance(e, PartyNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    if isinstance(e, PartyAccessForbiddenError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=e.message)
    if isinstance(e, PartyConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    if isinstance(e, PartyServiceError):
        return HTTPException(status_code=e.status_code, detail=e.message)

    logger.exception("Unexpected error in party router: %s", type(e).__name__)
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="An internal server error occurred. Please try again later.",
    )


@router.post(
    "",
    response_model=PartyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new private mystery party",
    description="Creates a two-player cooperative fellowship and generates an opaque invite token.",
)
async def create_party(
    request: PartyCreateRequest,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.create_party(current_user, request)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/join",
    response_model=PartyResponse,
    summary="Join an existing party using invitation token",
    description="Joins a party via private invite token. Enforces maximum 2 active members.",
)
async def join_party(
    request: PartyJoinRequest,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.join_party(current_user, request)
    except Exception as e:
        raise handle_party_error(e)


@router.get(
    "/mine",
    response_model=list[PartyResponse],
    summary="List authenticated explorer's parties",
    description="Retrieves parties where current explorer is an active member.",
)
@router.get(
    "/me",
    response_model=list[PartyResponse],
    summary="List authenticated explorer's parties (alias)",
    description="Retrieves parties where current explorer is an active member.",
)
async def list_my_parties(
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> list[PartyResponse]:
    try:
        return await service.list_user_parties(current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.get(
    "/{party_id}",
    response_model=PartyResponse,
    summary="Get party details",
    description="Retrieves party status, public member nicknames, and quest association.",
)
async def get_party(
    party_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.get_party(party_id, current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/leave",
    response_model=PartyResponse,
    summary="Leave party",
    description="Leaves the party. If host leaves, party is disbanded cleanly.",
)
async def leave_party(
    party_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.leave_party(party_id, current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/disband",
    response_model=PartyResponse,
    summary="Disband party (host only)",
    description="Disbands the fellowship and ends active cooperative quests cleanly.",
)
async def disband_party(
    party_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.disband_party(party_id, current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/consent",
    response_model=PartyResponse,
    summary="Set mutual identity reveal consent",
    description="Consents or revokes consent to revealing real explorer name to partner.",
)
async def set_identity_consent(
    party_id: uuid.UUID,
    request: ConsentRevealRequest,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyResponse:
    try:
        return await service.set_identity_reveal_consent(party_id, current_user, request)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/quest/start",
    response_model=SharedPartyQuestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a cooperative mystery quest",
    description="Generates a cooperative quest with split complementary clues for both explorers.",
)
async def start_cooperative_quest(
    party_id: uuid.UUID,
    request: PartyStartQuestRequest,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> SharedPartyQuestResponse:
    try:
        return await service.start_cooperative_quest(party_id, current_user, request)
    except Exception as e:
        raise handle_party_error(e)


@router.get(
    "/{party_id}/quest",
    response_model=SharedPartyQuestResponse,
    summary="Get shared quest progress",
    description="Retrieves caller's assigned clues and partner's progress indicators without GPS disclosure.",
)
async def get_shared_quest_progress(
    party_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> SharedPartyQuestResponse:
    try:
        return await service.get_shared_quest_progress(party_id, current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/clues/{clue_id}/unlock",
    response_model=SharedPartyQuestResponse,
    summary="Unlock assigned clue",
    description="Reveals an assigned progressive clue for the calling explorer.",
)
async def unlock_clue(
    party_id: uuid.UUID,
    clue_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> SharedPartyQuestResponse:
    try:
        return await service.unlock_assigned_clue(party_id, clue_id, current_user)
    except Exception as e:
        raise handle_party_error(e)


@router.post(
    "/{party_id}/quest/verify",
    response_model=PartyVerificationResponse,
    summary="Submit individual arrival and observation verification",
    description="Verifies explorer proximity and answer server-side without leaking GPS coordinates.",
)
async def verify_party_arrival(
    party_id: uuid.UUID,
    request: PartyVerifyRequest,
    current_user: User = Depends(get_current_user),
    service: PartyService = Depends(get_party_service),
) -> PartyVerificationResponse:
    try:
        return await service.verify_individual_arrival(party_id, current_user, request)
    except Exception as e:
        raise handle_party_error(e)
