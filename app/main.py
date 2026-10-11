import logging
from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine
from app.routers.registry import router as api_router

logger = logging.getLogger("waybound.main")

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
)

cors_origins = settings.cors_origins_list
allow_all_origins = "*" in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
    }


@app.get("/health/ready")
async def readiness() -> JSONResponse:
    db_status = "unknown"
    try:
        async with engine.connect() as conn:
            _ = await conn.execute(text("SELECT 1"))
        db_status = "connected"
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "status": "ready",
                "database": db_status,
                "environment": settings.environment,
            },
        )
    except Exception as exc:
        logger.error("Readiness probe database connection failed: %s", exc, exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "database": "disconnected",
                "environment": settings.environment,
            },
        )
