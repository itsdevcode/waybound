import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.profile import Profile
from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        result = await self.session.execute(
            select(User)
            .options(selectinload(User.profile))
            .where(User.id == user_id)
        )
        return result.scalars().first()

    async def get_profile_by_user_id(
        self,
        user_id: uuid.UUID,
        with_for_update: bool = False,
    ) -> Profile | None:
        stmt = select(Profile).where(Profile.user_id == user_id)
        if with_for_update:
            stmt = stmt.with_for_update()

        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def create_user(
        self,
        name: str,
        email: str,
        explorer_type: str = "mystery",
    ) -> User:
        user = User(name=name, email=email)
        profile = Profile(user=user, explorer_type=explorer_type, level=1, xp=0)
        self.session.add(user)
        self.session.add(profile)
        await self.session.flush()
        return user
