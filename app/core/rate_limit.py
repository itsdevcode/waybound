import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status

from app.core.config import settings


class InMemoryRateLimiter:
    """
    Sliding window rate limiter by client identifier (e.g. IP address or email).
    """

    def __init__(self, limit: int = 10, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._lock = Lock()
        self._attempts: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> None:
        now = time.time()
        with self._lock:
            # Clean expired timestamps
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

    def reset(self, key: str) -> None:
        with self._lock:
            _ = self._attempts.pop(key, None)


auth_rate_limiter = InMemoryRateLimiter(
    limit=settings.auth_rate_limit_per_minute,
    window_seconds=60,
)


def get_client_ip(request: Request) -> str:
    """
    Extracts the client IP from request headers or client host.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown_client"
