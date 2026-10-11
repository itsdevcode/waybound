import abc
import asyncio
import ipaddress
import logging
import time
from collections import defaultdict
from threading import Lock
from typing import override

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.rate_limit import AuthRateLimitEntry

logger = logging.getLogger("waybound.rate_limit")


class BaseRateLimiter(abc.ABC):
    @abc.abstractmethod
    async def check(self, key: str, db: AsyncSession | None = None, detail: str | None = None) -> None:
        pass

    @abc.abstractmethod
    async def reset(self, key: str, db: AsyncSession | None = None) -> None:
        pass


class InMemoryRateLimiter(BaseRateLimiter):
    """
    In-memory sliding window rate limiter by client identifier (e.g. IP address or email).
    """

    def __init__(
        self,
        limit: int = 10,
        window_seconds: int = 60,
        error_detail: str = "Too many requests. Please try again later.",
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.error_detail = error_detail
        self._lock = Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)

    @override
    async def check(self, key: str, db: AsyncSession | None = None, detail: str | None = None) -> None:
        now = time.time()
        with self._lock:
            cutoff = now - self.window_seconds
            self._attempts[key] = [t for t in self._attempts[key] if t > cutoff]

            if len(self._attempts[key]) >= self.limit:
                retry_after = int(self._attempts[key][0] + self.window_seconds - now) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=detail or self.error_detail,
                    headers={"Retry-After": str(max(1, retry_after))},
                )

            self._attempts[key].append(now)

    @override
    async def reset(self, key: str, db: AsyncSession | None = None) -> None:
        with self._lock:
            _ = self._attempts.pop(key, None)


class DatabaseRateLimiter(BaseRateLimiter):
    """
    Atomic database-backed sliding window rate limiter shared across multiple workers/nodes.
    Uses PostgreSQL advisory locks keyed on the hashed identifier to eliminate count-then-insert races.
    Fails safely (fail-closed) on lock failures instead of proceeding unprotected.
    """

    def __init__(
        self,
        limit: int = 10,
        window_seconds: int = 60,
        error_detail: str = "Too many requests. Please try again later.",
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.error_detail = error_detail
        self._fallback = InMemoryRateLimiter(limit=limit, window_seconds=window_seconds, error_detail=error_detail)
        self._async_locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    async def _get_async_lock(self, key: str) -> asyncio.Lock:
        async with self._locks_guard:
            if key not in self._async_locks:
                self._async_locks[key] = asyncio.Lock()
            return self._async_locks[key]

    async def _execute_window_check(
        self,
        db: AsyncSession,
        key: str,
        cutoff: float,
        now: float,
        detail: str | None = None,
    ) -> None:
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
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail or self.error_detail,
                headers={"Retry-After": str(max(1, retry_after))},
            )

        # Record this attempt atomically inside the locked transaction
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
    async def check(self, key: str, db: AsyncSession | None = None, detail: str | None = None) -> None:
        if db is None:
            await self._fallback.check(key, detail=detail)
            return

        now = time.time()
        cutoff = now - self.window_seconds

        is_postgres = False
        try:
            bind = getattr(db, "bind", None)
            if bind is None and callable(getattr(db, "get_bind", None)):
                bind = db.get_bind()
            if bind is not None and hasattr(bind, "dialect") and "postgresql" in bind.dialect.name:
                is_postgres = True
        except Exception:
            pass

        if is_postgres:
            # Under PostgreSQL, acquire a transaction-level advisory xact lock on a 32-bit integer hash of the key.
            # Fail closed on lock errors to maintain strict concurrency security.
            try:
                _ = await db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                    {"lock_key": f"rate_limit:{key}"},
                )
            except Exception as exc:
                logger.error("Failed to acquire PostgreSQL advisory lock for rate limiting: %s", exc)
                try:
                    await db.rollback()
                except Exception:
                    pass
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Rate limiting service temporarily unavailable.",
                ) from exc

            await self._execute_window_check(db, key, cutoff, now, detail)
        else:
            # Non-PostgreSQL dialect (e.g. SQLite during automated tests):
            # Acquire keyed process-level lock to guarantee concurrency safety without swallowing errors
            lock = await self._get_async_lock(key)
            async with lock:
                await self._execute_window_check(db, key, cutoff, now, detail)

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
    detail = "Too many authentication requests. Please try again later."
    if storage == "database":
        return DatabaseRateLimiter(limit=limit, window_seconds=60, error_detail=detail)
    return InMemoryRateLimiter(limit=limit, window_seconds=60, error_detail=detail)


auth_rate_limiter: BaseRateLimiter = create_rate_limiter()


def create_narration_rate_limiter() -> BaseRateLimiter:
    storage = str(settings.rate_limit_storage).lower().strip()
    limit = int(settings.elevenlabs_rate_limit_per_minute)
    detail = "Narration rate limit reached. Please try again later or use free browser speech."
    if storage == "database":
        return DatabaseRateLimiter(limit=limit, window_seconds=60, error_detail=detail)
    return InMemoryRateLimiter(limit=limit, window_seconds=60, error_detail=detail)


narration_rate_limiter: BaseRateLimiter = create_narration_rate_limiter()


def create_narration_user_daily_limiter() -> BaseRateLimiter:
    storage = str(settings.rate_limit_storage).lower().strip()
    limit = int(settings.elevenlabs_user_daily_limit)
    detail = "Daily voice narration credit limit reached for this explorer. Free browser narration remains available."
    if storage == "database":
        return DatabaseRateLimiter(limit=limit, window_seconds=86400, error_detail=detail)
    return InMemoryRateLimiter(limit=limit, window_seconds=86400, error_detail=detail)


narration_user_daily_limiter: BaseRateLimiter = create_narration_user_daily_limiter()


def create_narration_global_daily_limiter() -> BaseRateLimiter:
    storage = str(settings.rate_limit_storage).lower().strip()
    limit = int(settings.elevenlabs_global_daily_limit)
    detail = "System-wide voice narration credit limit reached for today. Free browser narration remains available."
    if storage == "database":
        return DatabaseRateLimiter(limit=limit, window_seconds=86400, error_detail=detail)
    return InMemoryRateLimiter(limit=limit, window_seconds=86400, error_detail=detail)


narration_global_daily_limiter: BaseRateLimiter = create_narration_global_daily_limiter()



def is_ip_trusted_proxy(ip_str: str, trusted_config: str) -> bool:
    """
    Checks whether an IP address belongs to the configured list of trusted proxies or networks.
    """
    if not ip_str or not trusted_config:
        return False

    try:
        remote_ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False

    for item in trusted_config.split(","):
        cleaned = item.strip()
        if not cleaned:
            continue
        try:
            if "/" in cleaned:
                network = ipaddress.ip_network(cleaned, strict=False)
                if remote_ip in network:
                    return True
            else:
                trusted_ip = ipaddress.ip_address(cleaned)
                if remote_ip == trusted_ip:
                    return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    """
    Safely resolves the client IP address.
    Never trusts client-supplied X-Forwarded-For headers directly.
    Only inspects proxy headers if the actual connecting socket IP (request.client.host)
    matches a configured trusted proxy or local proxy network.

    When behind a trusted proxy:
    1. Check X-Real-IP if set by the edge proxy.
    2. Otherwise traverse X-Forwarded-For from right to left, stripping trusted proxy hops
       and selecting the rightmost untrusted client IP to prevent client header injection.
    """
    direct_ip = request.client.host if request.client else "unknown_client"
    trusted_config = str(settings.trusted_proxies).strip()

    if direct_ip != "unknown_client" and is_ip_trusted_proxy(direct_ip, trusted_config):
        # 1. Prefer X-Real-IP if set by a trusted reverse proxy
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            cleaned_real_ip = real_ip.strip()
            try:
                _ = ipaddress.ip_address(cleaned_real_ip)
                return cleaned_real_ip
            except ValueError:
                pass

        # 2. Traverse X-Forwarded-For from right to left to find authentic client IP
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            candidates = [p.strip() for p in forwarded.split(",") if p.strip()]
            for candidate in reversed(candidates):
                try:
                    _ = ipaddress.ip_address(candidate)
                    if not is_ip_trusted_proxy(candidate, trusted_config):
                        return candidate
                except ValueError:
                    continue

    return direct_ip
