"""Seed a default demo explorer user into the database."""
import asyncio
import uuid
from app.db.session import AsyncSessionLocal
from app.models.quest import Quest  # noqa: F401
from app.models.quest_step import QuestStep  # noqa: F401
from app.models.profile import Profile
from app.models.user import User
from sqlalchemy import select

DEMO_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEMO_USER_EMAIL = "explorer@waybound.local"
DEMO_USER_NAME = "Lyra the Pathseeker"

async def seed():
    async with AsyncSessionLocal() as session:
        # Check if user already exists
        result = await session.execute(select(User).where(User.id == DEMO_USER_ID))
        user = result.scalars().first()
        if not user:
            # Check by email
            result = await session.execute(select(User).where(User.email == DEMO_USER_EMAIL))
            user = result.scalars().first()

        if not user:
            user = User(
                id=DEMO_USER_ID,
                name=DEMO_USER_NAME,
                email=DEMO_USER_EMAIL,
            )
            profile = Profile(
                user_id=DEMO_USER_ID,
                explorer_type="mystery",
                level=1,
                xp=0,
                social_enabled=False,
            )
            session.add(user)
            session.add(profile)
            await session.commit()
            print(f"Created demo user: {user.name} ({user.id})")
        else:
            print(f"Demo user already exists: {user.name} ({user.id})")

if __name__ == "__main__":
    asyncio.run(seed())
