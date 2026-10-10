# This file is managed by Fastisan.

from fastapi import APIRouter

from app.routers.quest import router as quest_router
from app.routers.user import router as user_router

router = APIRouter(prefix="/api/v1")

router.include_router(quest_router)
router.include_router(user_router)
