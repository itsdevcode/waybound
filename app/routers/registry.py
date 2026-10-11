from fastapi import APIRouter

from app.routers.auth import router as auth_router
from app.routers.narration import router as narration_router
from app.routers.party import router as party_router
from app.routers.quest import router as quest_router
from app.routers.user import router as user_router

router = APIRouter(prefix="/api/v1")

router.include_router(auth_router)
router.include_router(narration_router)
router.include_router(party_router)
router.include_router(quest_router)
router.include_router(user_router)
