import logging
import math
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.geo import calculate_haversine_distance_meters, calculate_profile_level
from app.models.quest import Quest
from app.models.quest_step import QuestStep
from app.repositories.quest import QuestRepository
from app.repositories.user import UserRepository
from app.schemas.quest import (
    NearbyQuestItem,
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
        if not request.user_id:
            raise UserNotFoundError("User ID is required to generate a quest")
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
            # Simulated demo quests are eligible for XP under verified simulation rules.
            # Real-world Google Places + Gemma quests award 0 XP while AI-generated observation answers
            # remain unverified, ensuring no progression XP is awarded based on unverified ground truth.
            # Additionally, if the client submitted manual city selection or unverified coordinates,
            # zero XP is awarded to prevent spoofing or bypassing physical presence.
            if request.is_manual_location:
                awarded_xp = 0
            elif is_simulation:
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

    async def get_nearby_quests(
        self,
        latitude: float,
        longitude: float,
        radius_meters: float = 1000.0,
        limit: int = 20,
        user_id: uuid.UUID | None = None,
    ) -> list[NearbyQuestItem]:
        """
        Discovers nearby quests and exploration markers within the specified radius.
        Includes:
        1. Any active, draft, or completed quests associated with the explorer within the radius.
        2. Configured exploration destinations (from provider or simulated catalog) within radius.
        Maintains secrecy: Only active quest destinations or completed destinations disclose target details.
        """
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            raise ValueError("Geographic coordinates must be finite real numbers.")
        if not (-90.0 <= latitude <= 90.0):
            raise ValueError(f"Latitude must be between -90 and 90 degrees, got {latitude}.")
        if not (-180.0 <= longitude <= 180.0):
            raise ValueError(f"Longitude must be between -180 and 180 degrees, got {longitude}.")
        if not math.isfinite(radius_meters) or radius_meters <= 0:
            raise ValueError("Radius must be a positive finite number.")
        if not (100.0 <= radius_meters <= 50000.0):
            raise ValueError(f"Radius must be between 100m and 50,000m, got {radius_meters}.")

        safe_limit = min(max(limit, 1), 50)
        nearby_items: list[NearbyQuestItem] = []
        seen_coords: set[tuple[float, float]] = set()

        # 1. If user is authenticated, query their active and recent quests
        if user_id:
            user_quests = await self.quest_repo.list_by_user_id(user_id)
            for uq in user_quests:
                dest_lat = float(uq.destination_latitude)
                dest_lon = float(uq.destination_longitude)
                dist = calculate_haversine_distance_meters(
                    latitude, longitude, dest_lat, dest_lon
                )
                if dist <= radius_meters:
                    seen_coords.add((round(dest_lat, 5), round(dest_lon, 5)))
                    status_mapped = "active" if uq.status == "active" else (
                        "completed" if uq.status == "completed" else "available"
                    )
                    is_completed = (uq.status == "completed")
                    # Destination Secrecy: Never expose unrevealed coordinates before arrival & completion
                    display_lat = dest_lat if is_completed else latitude
                    display_lon = dest_lon if is_completed else longitude
                    display_dist = round(dist, 1) if is_completed else 0.0

                    nearby_items.append(
                        NearbyQuestItem(
                            id=uq.id,
                            title=uq.title,
                            description=uq.description[:180] + ("..." if len(uq.description) > 180 else ""),
                            difficulty=uq.difficulty,
                            estimated_minutes=uq.estimated_minutes,
                            reward_xp=uq.reward_xp,
                            status=status_mapped,
                            latitude=display_lat,
                            longitude=display_lon,
                            distance_meters=display_dist,
                            verification_radius_meters=settings.verification_radius_meters,
                            is_active=(uq.status == "active"),
                            is_destination_secret=(not is_completed),
                        )
                    )

        # 2. Add available exploration candidate destinations
        # Check if Google Places API is configured or if provider is google_places_gemma
        is_google_places_enabled = bool(settings.google_maps_api_key.strip())
        real_places_found = False

        if is_google_places_enabled:
            try:
                from app.services.places import GooglePlacesService
                places_svc = GooglePlacesService()
                place_candidates = await places_svc.search_nearby_places(
                    latitude=latitude,
                    longitude=longitude,
                    radius_meters=radius_meters,
                    max_results=min(safe_limit, 20),
                )
                for candidate in place_candidates:
                    coord_key = (round(candidate.latitude, 5), round(candidate.longitude, 5))
                    if coord_key in seen_coords:
                        continue
                    seen_coords.add(coord_key)
                    dist = candidate.distance_meters if candidate.distance_meters is not None else calculate_haversine_distance_meters(
                        latitude, longitude, candidate.latitude, candidate.longitude
                    )
                    type_formatted = candidate.primary_type.replace("_", " ").title() if candidate.primary_type else "Curiosity"
                    nearby_items.append(
                        NearbyQuestItem(
                            id=None,
                            title=f"The Mystery of {candidate.name}",
                            description=f"Real-world public {type_formatted}. Discover history and local secrets at this verified landmark.",
                            difficulty="medium",
                            estimated_minutes=30,
                            reward_xp=150,
                            status="available",
                            latitude=candidate.latitude,
                            longitude=candidate.longitude,
                            distance_meters=round(dist, 1),
                            verification_radius_meters=settings.verification_radius_meters,
                            is_active=False,
                            is_simulated=False,
                        )
                    )
                if place_candidates:
                    real_places_found = True
            except Exception as e:
                logger.warning(
                    "Google Places discovery failed in get_nearby_quests, falling back to simulated catalog: %s",
                    type(e).__name__,
                )

        # 3. Explicit simulated demo fallback when Google Places is unconfigured or returns no results
        if not real_places_found:
            from app.services.providers.demo import DEFAULT_DEMO_DESTINATIONS

            for candidate in DEFAULT_DEMO_DESTINATIONS:
                coord_key = (round(candidate.latitude, 5), round(candidate.longitude, 5))
                if coord_key in seen_coords:
                    continue

                dist = calculate_haversine_distance_meters(
                    latitude, longitude, candidate.latitude, candidate.longitude
                )
                # If within radius
                if dist <= radius_meters:
                    seen_coords.add(coord_key)
                    title_clean = candidate.name.replace("[Simulated Demo] ", "[Demo Scenario] ")
                    nearby_items.append(
                        NearbyQuestItem(
                            id=None,
                            title=title_clean,
                            description=f"[Simulated POI - 0 XP] {candidate.description[:140]}...",
                            difficulty=candidate.difficulties[0] if candidate.difficulties else "medium",
                            estimated_minutes=candidate.suitable_minutes[0] if candidate.suitable_minutes else 30,
                            reward_xp=150,
                            status="available",
                            latitude=candidate.latitude,
                            longitude=candidate.longitude,
                            distance_meters=round(dist, 1),
                            verification_radius_meters=settings.verification_radius_meters,
                            is_active=False,
                            is_simulated=True,
                        )
                    )

        # Sort by distance (nearest first)
        nearby_items.sort(key=lambda item: item.distance_meters)
        return nearby_items[:safe_limit]
