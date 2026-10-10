import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.repositories.quest import QuestRepository
from app.repositories.user import UserRepository
from app.schemas.quest import QuestResponse
from app.schemas.user import ProfileResponse
from app.services.providers.factory import create_quest_provider
from app.services.quest import QuestService, UserNotFoundError
from app.services.user import UserService

router = APIRouter(
    prefix="/users",
    tags=["Users"],
)


def get_user_service(
    session: AsyncSession = Depends(get_session),
) -> UserService:
    user_repo = UserRepository(session)
    return UserService(session=session, user_repository=user_repo)


def get_quest_service(
    session: AsyncSession = Depends(get_session),
) -> QuestService:
    quest_repo = QuestRepository(session)
    user_repo = UserRepository(session)
    try:
        provider = create_quest_provider()
    except Exception as e:
        logger.error("Configuration or provider error in user service: %s", type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error. Please contact administrator.",
        )
    return QuestService(
        session=session,
        quest_repository=quest_repo,
        user_repository=user_repo,
        quest_provider=provider,
    )


import logging

logger = logging.getLogger(__name__)


@router.get(
    "/{user_id}/profile",
    response_model=ProfileResponse,
    summary="View explorer progression",
    description="Retrieves the explorer profile including current XP, level, and preferences. (Identity note: user_id is demo-only)",
)
async def get_user_profile(
    user_id: uuid.UUID,
    service: UserService = Depends(get_user_service),
) -> ProfileResponse:
    try:
        return await service.get_profile(user_id)
    except UserNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except Exception as e:
        logger.exception("Unexpected error fetching user profile: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal server error occurred. Please try again later.",
        )


@router.get(
    "/{user_id}/quests",
    response_model=list[QuestResponse],
    summary="View quest history",
    description="Retrieves quest history for the specified explorer.",
)
async def get_user_quests(
    user_id: uuid.UUID,
    service: QuestService = Depends(get_quest_service),
) -> list[QuestResponse]:
    try:
        return await service.list_user_quests(user_id)
    except UserNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except Exception as e:
        logger.exception("Unexpected error fetching user quests: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal server error occurred. Please try again later.",
        )
