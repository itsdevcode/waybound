import math
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.geo import calculate_haversine_distance_meters, calculate_profile_level
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.repositories.quest import QuestRepository
from app.repositories.user import UserRepository
from app.schemas.quest import (
    QuestCreateRequest,
    QuestHintResponse,
    QuestResponse,
    QuestStepResponse,
    QuestVerificationResponse,
    QuestVerifyRequest,
)
from app.services.providers.base import QuestProvider


class QuestError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class QuestNotFoundError(QuestError):
    def __init__(self, message: str = "Quest not found") -> None:
        super().__init__(message, status_code=404)


class UserNotFoundError(QuestError):
    def __init__(self, message: str = "User not found") -> None:
        super().__init__(message, status_code=404)


class QuestConflictError(QuestError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=409)


class QuestService:
    def __init__(
        self,
        session: AsyncSession,
        quest_repository: QuestRepository,
        user_repository: UserRepository,
        quest_provider: QuestProvider,
    ) -> None:
        self.session = session
        self.quest_repo = quest_repository
        self.user_repo = user_repository
        self.provider = quest_provider

    def _to_response_schema(self, quest: Quest) -> QuestResponse:
        """
        Converts a Quest model to public QuestResponse.
        CRITICAL SECURITY REQUIREMENT:
        Never expose hidden destination coordinates or destination name before successful completion.
        Only expose unlocked clues.
        """
        is_completed = quest.status == "completed"

        # Filter only unlocked steps
        unlocked_steps = [
            QuestStepResponse.model_validate(step)
            for step in quest.steps
            if step.is_unlocked
        ]
        unlocked_steps.sort(key=lambda s: s.step_order)

        # Verification prompt is shown during active or completed status
        verification_prompt = (
            quest.verification_prompt
            if quest.status in ("active", "completed")
            else None
        )

        return QuestResponse(
            id=quest.id,
            title=quest.title,
            description=quest.description,
            difficulty=quest.difficulty,
            estimated_minutes=quest.estimated_minutes,
            reward_xp=quest.reward_xp,
            status=quest.status,
            current_clues=unlocked_steps,
            verification_prompt=verification_prompt,
            destination_name=quest.destination_name if is_completed else None,
            created_at=quest.created_at,
            started_at=quest.started_at,
            completed_at=quest.completed_at,
            updated_at=quest.updated_at,
        )

    async def generate_quest(self, request: QuestCreateRequest) -> QuestResponse:
        user = await self.user_repo.get_by_id(request.user_id)
        if not user:
            raise UserNotFoundError(f"User {request.user_id} not found")

        # Generate content via configured provider
        generated = await self.provider.generate_quest(request)

        # Build quest model and initial steps
        quest = Quest(
            user_id=request.user_id,
            title=generated.title,
            description=generated.description,
            difficulty=generated.difficulty,
            estimated_minutes=generated.estimated_minutes,
            reward_xp=generated.reward_xp,
            status="draft",
            destination_name=generated.destination_name,
            destination_latitude=generated.destination_latitude,
            destination_longitude=generated.destination_longitude,
            verification_prompt=generated.verification_prompt,
            verification_answer=generated.verification_answer,
        )

        # Add steps (initially locked; first unlocks on start)
        for idx, clue_text in enumerate(generated.clues, start=1):
            step = QuestStep(
                step_order=idx,
                clue=clue_text,
                is_unlocked=False,
            )
            quest.steps.append(step)

        await self.quest_repo.create(quest)
        await self.session.commit()
        refreshed = await self.quest_repo.get_by_id(quest.id)
        return self._to_response_schema(refreshed or quest)

    async def get_quest(self, quest_id: uuid.UUID) -> QuestResponse:
        quest = await self.quest_repo.get_by_id(quest_id)
        if not quest:
            raise QuestNotFoundError(f"Quest {quest_id} not found")
        return self._to_response_schema(quest)

    async def list_user_quests(self, user_id: uuid.UUID) -> list[QuestResponse]:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise UserNotFoundError(f"User {user_id} not found")

        quests = await self.quest_repo.list_by_user_id(user_id)
        return [self._to_response_schema(q) for q in quests]

    async def start_quest(self, quest_id: uuid.UUID) -> QuestResponse:
        quest = await self.quest_repo.get_by_id(quest_id)
        if not quest:
            raise QuestNotFoundError(f"Quest {quest_id} not found")

        # State transition validation
        if quest.status == "active":
            raise QuestConflictError("Quest is already active")
        if quest.status in ("completed", "abandoned"):
            raise QuestConflictError(f"Cannot start quest from '{quest.status}' state")
        if quest.status != "draft":
            raise QuestConflictError(f"Invalid state transition from '{quest.status}' to 'active'")

        # Transition draft -> active
        quest.status = "active"
        quest.started_at = datetime.now(timezone.utc)

        # Unlock the first clue
        sorted_steps = sorted(quest.steps, key=lambda s: s.step_order)
        if sorted_steps:
            sorted_steps[0].is_unlocked = True

        await self.session.commit()
        refreshed = await self.quest_repo.get_by_id(quest_id)
        return self._to_response_schema(refreshed or quest)

    async def unlock_hint(self, quest_id: uuid.UUID) -> QuestHintResponse:
        quest = await self.quest_repo.get_by_id(quest_id)
        if not quest:
            raise QuestNotFoundError(f"Quest {quest_id} not found")

        if quest.status != "active":
            raise QuestConflictError(
                f"Hints can only be unlocked on active quests (current status: '{quest.status}')"
            )

        sorted_steps = sorted(quest.steps, key=lambda s: s.step_order)
        locked_steps = [s for s in sorted_steps if not s.is_unlocked]

        if not locked_steps:
            # All hints already unlocked
            return QuestHintResponse(
                unlocked_step=None,
                all_hints_unlocked=True,
                quest=self._to_response_schema(quest),
            )

        # Unlock exactly the next clue
        next_step = locked_steps[0]
        next_step.is_unlocked = True
        await self.session.commit()
        refreshed = await self.quest_repo.get_by_id(quest_id)
        refreshed_quest = refreshed or quest

        remaining_locked = [s for s in refreshed_quest.steps if not s.is_unlocked]
        return QuestHintResponse(
            unlocked_step=QuestStepResponse.model_validate(next_step),
            all_hints_unlocked=len(remaining_locked) == 0,
            quest=self._to_response_schema(refreshed_quest),
        )

    async def abandon_quest(self, quest_id: uuid.UUID) -> QuestResponse:
        quest = await self.quest_repo.get_by_id(quest_id)
        if not quest:
            raise QuestNotFoundError(f"Quest {quest_id} not found")

        if quest.status == "completed":
            raise QuestConflictError("A completed quest cannot be abandoned")
        if quest.status == "abandoned":
            raise QuestConflictError("Quest is already abandoned")
        if quest.status not in ("draft", "active"):
            raise QuestConflictError(f"Cannot abandon quest from '{quest.status}' state")

        quest.status = "abandoned"
        await self.session.commit()
        refreshed = await self.quest_repo.get_by_id(quest_id)
        return self._to_response_schema(refreshed or quest)

    async def verify_quest(
        self,
        quest_id: uuid.UUID,
        request: QuestVerifyRequest,
    ) -> QuestVerificationResponse:
        # Validate coordinates are valid numbers and finite
        if not math.isfinite(request.latitude) or not math.isfinite(request.longitude):
            raise QuestError("Coordinates must be valid finite numbers", status_code=422)

        # Ensure transaction is active and lock rows atomically
        if not self.session.in_transaction():
            await self.session.begin()

        try:
            quest = await self.quest_repo.get_by_id(quest_id, with_for_update=True)
            if not quest:
                raise QuestNotFoundError(f"Quest {quest_id} not found")

            if quest.status == "completed":
                raise QuestConflictError("Quest is already completed")
            if quest.status != "active":
                raise QuestConflictError(
                    f"Only active quests can be verified (current status: '{quest.status}')"
                )

            # Check geographic proximity using Haversine
            dest_lat = float(quest.destination_latitude)
            dest_lon = float(quest.destination_longitude)
            distance_meters = calculate_haversine_distance_meters(
                request.latitude,
                request.longitude,
                dest_lat,
                dest_lon,
            )

            radius_limit = settings.verification_radius_meters
            if distance_meters > radius_limit:
                raise QuestError(
                    f"Verification failed: Location is not within the target destination area.",
                    status_code=400,
                )

            is_simulation = quest.destination_name.startswith("[Simulated Demo]")

            # Check observation answer (case-insensitive trimmed comparison)
            normalized_answer = request.observation_answer.strip().lower()
            expected_answer = quest.verification_answer.strip().lower()

            if normalized_answer != expected_answer:
                # Do NOT leak the expected answer or give clue hints in error response
                raise QuestError(
                    "Verification failed: The observation answer did not match the expected site observation.",
                    status_code=400,
                )

            # Verification succeeded! Complete quest
            quest.status = "completed"
            quest.completed_at = datetime.now(timezone.utc)

            # Unlock all remaining steps upon successful completion
            for step in quest.steps:
                step.is_unlocked = True

            # Atomically lock profile to award XP
            profile = await self.user_repo.get_profile_by_user_id(
                quest.user_id,
                with_for_update=True,
            )
            if not profile:
                raise UserNotFoundError("Explorer profile not found for quest owner")

            # Real-world verification safety:
            # Award progression XP for:
            # 1. Explicit simulation mode (testing & local development), or
            # 2. When allow_unverified_real_world_xp is explicitly configured true.
            # Otherwise, complete the quest safely without inflating real-world explorer XP on unverified AI ground-truth.
            if is_simulation or settings.allow_unverified_real_world_xp:
                awarded_xp = quest.reward_xp
            else:
                awarded_xp = 0

            if awarded_xp > 0:
                profile.xp += awarded_xp
                profile.level = calculate_profile_level(profile.xp)

            await self.session.flush()
            await self.session.refresh(quest, ["steps"])
            await self.session.refresh(profile)

            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

        # Re-fetch quest with steps eagerly to ensure no expired attributes
        refreshed_quest = await self.quest_repo.get_by_id(quest_id)
        if not refreshed_quest:
            raise QuestNotFoundError(f"Quest {quest_id} not found")

        if is_simulation:
            completion_message = (
                "[Simulated Demo] Quest verified successfully in simulation mode. Destination details unlocked. "
                "(Notice: Simulated test scenario, not field-verified outdoor exploration)."
            )
        elif awarded_xp > 0:
            completion_message = "Quest verified successfully! Real-world destination unlocked."
        else:
            completion_message = (
                "Quest completed and destination unlocked! Notice: Real-world progression XP is withheld pending "
                "field-verified observation ground truth."
            )

        return QuestVerificationResponse(
            success=True,
            message=completion_message,
            reward_xp_awarded=awarded_xp,
            total_xp=profile.xp,
            level=profile.level,
            quest=self._to_response_schema(refreshed_quest),
        )
