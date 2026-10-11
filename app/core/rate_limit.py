import abc
import time
from collections import defaultdict
from threading import Lock
from typing import override

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.rate_limit import AuthRateLimitEntry


class BaseRateLimiter(abc.ABC):
    @abc.abstractmethod
    async def check(self, key: str, db: AsyncSession | None = None) -> None:
        pass

    @abc.abstractmethod
    async def reset(self, key: str, db: AsyncSession | None = None) -> None:
        pass


class InMemoryRateLimiter(BaseRateLimiter):
    """
    In-memory sliding window rate limiter by client identifier (e.g. IP address or email).
    """

    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._lock = Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)

    @override
    async def check(self, key: str, db: AsyncSession | None = None) -> None:
        now = time.time()
        with self._lock:
            cutoff = now - self.window_seconds
            self._attempts[key] = [t for t in self._attempts[key] if t > cutoff]

            if len(self._attempts[key]) >= self.limit:
                retry_after = int(self._attempts[key][0] + self.window_seconds - now) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many authentication requests. Please try again later.",
                    headers={"Retry-After": str(max(1, retry_after))},
                )

            self._attempts[key].append(now)

    @override
    async def reset(self, key: str, db: AsyncSession | None = None) -> None:
        with self._lock:
            _ = self._attempts.pop(key, None)


class DatabaseRateLimiter(BaseRateLimiter):
    """
    Database-backed sliding window rate limiter shared across multiple workers/nodes.
    """

    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._fallback = InMemoryRateLimiter(limit=limit, window_seconds=window_seconds)

    @override
    async def check(self, key: str, db: AsyncSession | None = None) -> None:
        if db is None:
            await self._fallback.check(key)
            return

        now = time.time()
        cutoff = now - self.window_seconds

        # Query recent attempts within the sliding window
        stmt = (
            select(AuthRateLimitEntry.timestamp)
            .where(
                AuthRateLimitEntry.key == key,
                AuthRateLimitEntry.timestamp > cutoff,
            )
            .order_by(AuthRateLimitEntry.timestamp.asc())
        )
        timestamps = (await db.execute(stmt)).scalars().all()

        if len(timestamps) >= self.limit:
            oldest = timestamps[0]
            retry_after = int(oldest + self.window_seconds - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many authentication requests. Please try again later.",
                headers={"Retry-After": str(max(1, retry_after))},
            )

        # Record this attempt
        entry = AuthRateLimitEntry(key=key, timestamp=now)
        db.add(entry)
        await db.commit()

        # Opportunistic cleanup: delete expired rows for this key
        del_stmt = delete(AuthRateLimitEntry).where(
            AuthRateLimitEntry.key == key,
            AuthRateLimitEntry.timestamp <= cutoff,
        )
        _ = await db.execute(del_stmt)
        await db.commit()

    @override
    async def reset(self, key: str, db: AsyncSession | None = None) -> None:
        if db is None:
            await self._fallback.reset(key)
            return

        del_stmt = delete(AuthRateLimitEntry).where(AuthRateLimitEntry.key == key)
        _ = await db.execute(del_stmt)
        await db.commit()


def create_rate_limiter() -> BaseRateLimiter:
    storage = str(settings.rate_limit_storage).lower().strip()
    limit = int(settings.auth_rate_limit_per_minute)
    if storage == "database":
        return DatabaseRateLimiter(limit=limit, window_seconds=60)
    return InMemoryRateLimiter(limit=limit, window_seconds=60)


auth_rate_limiter: BaseRateLimiter = create_rate_limiter()


def get_client_ip(request: Request) -> str:
    """
    Extracts the client IP from request headers or client host.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown_client"
