import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuthRateLimitEntry(Base):
    """
    Persistent rate limit event entry shared across multiple workers/nodes.
    """
    __tablename__ = "auth_rate_limit_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    key: Mapped[str] = mapped_column(
        String(255),
        index=True,
        nullable=False,
    )
    timestamp: Mapped[float] = mapped_column(
        Float,
        index=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__: tuple[Index, ...] = (
        Index("ix_rate_limit_key_timestamp", "key", "timestamp"),
    )
