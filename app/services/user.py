import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import Profile
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.user import ProfileResponse, UserResponse
from app.services.quest import UserNotFoundError


class UserService:
    def __init__(
        self,
        session: AsyncSession,
        user_repository: UserRepository,
    ) -> None:
        self.session = session
        self.user_repo = user_repository

    async def get_profile(self, user_id: uuid.UUID) -> ProfileResponse:
        profile = await self.user_repo.get_profile_by_user_id(user_id)
        if not profile:
            raise UserNotFoundError(f"Profile for user {user_id} not found")
        return ProfileResponse.model_validate(profile)

    async def get_user(self, user_id: uuid.UUID) -> UserResponse:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise UserNotFoundError(f"User {user_id} not found")
        return UserResponse.model_validate(user)
