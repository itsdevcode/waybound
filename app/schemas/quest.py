import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


ExplorerType = Literal["discovery", "nature", "fitness", "mystery", "social"]
DifficultyType = Literal["easy", "medium", "hard"]
AvailableMinutesType = Literal[15, 30, 60]
QuestStatusType = Literal["draft", "active", "completed", "abandoned"]


# --- Request Schemas ---

class QuestCreateRequest(BaseModel):
    user_id: uuid.UUID
    available_minutes: AvailableMinutesType
    explorer_type: ExplorerType
    difficulty: DifficultyType


class QuestVerifyRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Observed latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Observed longitude")
    observation_answer: str = Field(..., min_length=1, max_length=500, description="User observation answer")


# --- Response Clue Schema ---

class QuestStepResponse(BaseModel):
    id: uuid.UUID
    step_order: int
    clue: str
    is_unlocked: bool

    model_config = ConfigDict(from_attributes=True)


# --- Public Quest Response ---

class QuestResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    difficulty: str
    estimated_minutes: int
    reward_xp: int
    status: str
    current_clues: list[QuestStepResponse]
    verification_prompt: str | None = None
    destination_name: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Verification Outcome Response ---

class QuestVerificationResponse(BaseModel):
    success: bool
    message: str
    reward_xp_awarded: int
    total_xp: int
    level: int
    quest: QuestResponse


# --- Hint Response ---

class QuestHintResponse(BaseModel):
    unlocked_step: QuestStepResponse | None
    all_hints_unlocked: bool
    quest: QuestResponse


# --- Internal Destination Data Schema ---

class DestinationCandidate(BaseModel):
    name: str
    latitude: float
    longitude: float
    description: str
    explorer_types: list[ExplorerType]
    difficulties: list[DifficultyType]
    suitable_minutes: list[AvailableMinutesType]
    verification_prompt: str
    verification_answer: str
    clues: list[str]
