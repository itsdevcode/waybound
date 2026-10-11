# pyright: reportImportCycles=false
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.quest import Quest
    from app.models.user import User


class Party(Base):
    __tablename__ = "parties"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'active', 'completed', 'disbanded')",
            name="ck_parties_status_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    host_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="Mystery Fellowship",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="open",
        nullable=False,
        index=True,
    )
    invite_token_hash: Mapped[str | None] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=True,
    )
    invite_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    host: Mapped["User"] = relationship(
        foreign_keys=[host_id],
    )
    memberships: Mapped[list["PartyMembership"]] = relationship(
        back_populates="party",
        cascade="all, delete-orphan",
        order_by="PartyMembership.joined_at",
    )
    party_quest: Mapped["PartyQuest | None"] = relationship(
        back_populates="party",
        cascade="all, delete-orphan",
        uselist=False,
    )


class PartyMembership(Base):
    __tablename__ = "party_memberships"
    __table_args__ = (
        UniqueConstraint("party_id", "user_id", name="uq_party_memberships_party_user"),
        CheckConstraint(
            "role IN ('host', 'member')",
            name="ck_party_memberships_role_valid",
        ),
        CheckConstraint(
            "status IN ('active', 'left', 'removed')",
            name="ck_party_memberships_status_valid",
        ),
        CheckConstraint(
            "slot_number IN (1, 2)",
            name="ck_party_memberships_slot_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    party_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parties.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(20),
        default="member",
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
        index=True,
    )
    slot_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Slot 1 or 2 in two-player party. Maps to clue split assignment.",
    )
    nickname: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Explorer nickname displayed to partner by default.",
    )
    consent_reveal_identity: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="Explicit consent to reveal real explorer name to partner.",
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    left_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    party: Mapped["Party"] = relationship(
        back_populates="memberships",
    )
    user: Mapped["User"] = relationship(
        back_populates="party_memberships",
    )
    verifications: Mapped[list["MemberVerification"]] = relationship(
        back_populates="membership",
        cascade="all, delete-orphan",
    )


class PartyQuest(Base):
    __tablename__ = "party_quests"
    __table_args__ = (
        UniqueConstraint("party_id", name="uq_party_quests_party_id"),
        UniqueConstraint("quest_id", name="uq_party_quests_quest_id"),
        CheckConstraint(
            "status IN ('active', 'completed', 'abandoned')",
            name="ck_party_quests_status_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    party_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("parties.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("quests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    party: Mapped["Party"] = relationship(
        back_populates="party_quest",
    )
    quest: Mapped["Quest"] = relationship()
    split_clues: Mapped[list["SplitClue"]] = relationship(
        back_populates="party_quest",
        cascade="all, delete-orphan",
        order_by="SplitClue.step_order",
    )


class SplitClue(Base):
    __tablename__ = "split_clues"
    __table_args__ = (
        UniqueConstraint("party_quest_id", "assigned_slot", "step_order", name="uq_split_clues_slot_order"),
        CheckConstraint("assigned_slot IN (1, 2)", name="ck_split_clues_assigned_slot_valid"),
        CheckConstraint("step_order >= 1", name="ck_split_clues_step_order_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    party_quest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("party_quests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_slot: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="1 for explorer 1, 2 for explorer 2",
    )
    step_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    clue_title: Mapped[str] = mapped_column(
        String(100),
        default="Assigned Field Clue",
        nullable=False,
    )
    clue_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    is_revealed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    revealed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    party_quest: Mapped["PartyQuest"] = relationship(
        back_populates="split_clues",
    )


class MemberVerification(Base):
    __tablename__ = "member_verifications"
    __table_args__ = (
        UniqueConstraint("party_quest_id", "user_id", name="uq_member_verifications_quest_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    party_quest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("party_quests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    membership_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("party_memberships.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    distance_meters: Mapped[float | None] = mapped_column(
        Numeric(10, 2),
        nullable=True,
    )
    observation_answer_submitted: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    reward_xp_awarded: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    membership: Mapped["PartyMembership"] = relationship(
        back_populates="verifications",
    )
    user: Mapped["User"] = relationship()
