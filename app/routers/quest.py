import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.repositories.quest import QuestRepository
from app.repositories.user import UserRepository
from app.schemas.quest import (
    QuestCreateRequest,
    QuestHintResponse,
    QuestResponse,
    QuestVerificationResponse,
    QuestVerifyRequest,
)
from app.services.providers.demo import DemoQuestProvider
from app.services.quest import (
    QuestConflictError,
    QuestError,
    QuestNotFoundError,
    QuestService,
    UserNotFoundError,
)

router = APIRouter(
    prefix="/quests",
    tags=["Quests"],
)


def get_quest_service(
    session: AsyncSession = Depends(get_session),
) -> QuestService:
    quest_repo = QuestRepository(session)
    user_repo = UserRepository(session)
    provider = DemoQuestProvider()
    return QuestService(
        session=session,
        quest_repository=quest_repo,
        user_repository=user_repo,
        quest_provider=provider,
    )


def handle_service_error(e: Exception) -> HTTPException:
    if isinstance(e, QuestNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    if isinstance(e, UserNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    if isinstance(e, QuestConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    if isinstance(e, QuestError):
        return HTTPException(status_code=e.status_code, detail=e.message)
    import traceback
    traceback.print_exc()
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/generate",
    response_model=QuestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a draft quest",
    description="Generates a deterministic draft quest for the specified explorer. (Identity note: caller-supplied user_id is demo-only)",
)
async def generate_quest(
    request: QuestCreateRequest,
    service: QuestService = Depends(get_quest_service),
) -> QuestResponse:
    try:
        return await service.generate_quest(request)
    except Exception as e:
        raise handle_service_error(e)


@router.post(
    "/{quest_id}/start",
    response_model=QuestResponse,
    summary="Start a draft quest",
    description="Transitions quest from draft to active and unlocks the first clue.",
)
async def start_quest(
    quest_id: uuid.UUID,
    service: QuestService = Depends(get_quest_service),
) -> QuestResponse:
    try:
        return await service.start_quest(quest_id)
    except Exception as e:
        raise handle_service_error(e)


@router.get(
    "/{quest_id}",
    response_model=QuestResponse,
    summary="Get quest state",
    description="Retrieves the current quest state. Hidden coordinates and destination name are withheld until completion.",
)
async def get_quest(
    quest_id: uuid.UUID,
    service: QuestService = Depends(get_quest_service),
) -> QuestResponse:
    try:
        return await service.get_quest(quest_id)
    except Exception as e:
        raise handle_service_error(e)


@router.post(
    "/{quest_id}/hint",
    response_model=QuestHintResponse,
    summary="Unlock next hint",
    description="Unlocks exactly one additional clue in sequential order.",
)
async def unlock_hint(
    quest_id: uuid.UUID,
    service: QuestService = Depends(get_quest_service),
) -> QuestHintResponse:
    try:
        return await service.unlock_hint(quest_id)
    except Exception as e:
        raise handle_service_error(e)


@router.post(
    "/{quest_id}/verify",
    response_model=QuestVerificationResponse,
    summary="Verify quest completion",
    description="Verifies user location coordinates and observation answer. Awards XP atomically on success.",
)
async def verify_quest(
    quest_id: uuid.UUID,
    request: QuestVerifyRequest,
    service: QuestService = Depends(get_quest_service),
) -> QuestVerificationResponse:
    try:
        return await service.verify_quest(quest_id, request)
    except Exception as e:
        raise handle_service_error(e)


@router.post(
    "/{quest_id}/abandon",
    response_model=QuestResponse,
    summary="Abandon quest",
    description="Transitions a draft or active quest to abandoned state.",
)
async def abandon_quest(
    quest_id: uuid.UUID,
    service: QuestService = Depends(get_quest_service),
) -> QuestResponse:
    try:
        return await service.abandon_quest(quest_id)
    except Exception as e:
        raise handle_service_error(e)
