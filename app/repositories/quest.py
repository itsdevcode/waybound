import uuid
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.quest import Quest
from app.models.quest_step import QuestStep


class QuestRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_by_user_id(self, user_id: uuid.UUID) -> list[Quest]:
        result = await self.session.execute(
            select(Quest)
            .options(selectinload(Quest.steps))
            .where(Quest.user_id == user_id)
            .order_by(desc(Quest.created_at))
        )
        return list(result.scalars().all())

    async def get_by_id(
        self,
        quest_id: uuid.UUID,
        with_for_update: bool = False,
    ) -> Quest | None:
        stmt = (
            select(Quest)
            .options(selectinload(Quest.steps))
            .where(Quest.id == quest_id)
        )
        if with_for_update:
            stmt = stmt.with_for_update()

        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def create(self, quest: Quest) -> Quest:
        self.session.add(quest)
        await self.session.flush()
        return quest

    async def unlock_step(self, step: QuestStep) -> None:
        step.is_unlocked = True
        await self.session.flush()
