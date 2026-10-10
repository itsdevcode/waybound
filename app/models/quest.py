# pyright: reportImportCycles=false
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.quest_step import QuestStep
    from app.models.user import User


class Quest(Base):
    __tablename__ = "quests"
    __table_args__ = (
        CheckConstraint("reward_xp >= 0", name="ck_quests_reward_xp_nonnegative"),
        CheckConstraint("estimated_minutes > 0", name="ck_quests_estimated_minutes_positive"),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_quests_difficulty_valid",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'completed', 'abandoned')",
            name="ck_quests_status_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    difficulty: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    estimated_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    reward_xp: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="draft",
        nullable=False,
        index=True,
    )
    destination_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    destination_latitude: Mapped[float] = mapped_column(
        Numeric(9, 6),
        nullable=False,
    )
    destination_longitude: Mapped[float] = mapped_column(
        Numeric(9, 6),
        nullable=False,
    )
    verification_prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    verification_answer: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship(
        back_populates="quests",
    )
    steps: Mapped[list["QuestStep"]] = relationship(
        back_populates="quest",
        cascade="all, delete-orphan",
        order_by="QuestStep.step_order",
    )
