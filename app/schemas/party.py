import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.quest import AvailableMinutesType, DifficultyType, ExplorerType


# Auth / Session Schemas
class SessionCreateRequest(BaseModel):
    user_id: uuid.UUID = Field(..., description="Explorer ID to authenticate")


class SessionResponse(BaseModel):
    token: str = Field(..., description="Opaque session token (Bearer token)")
    user_id: uuid.UUID
    user_name: str
    explorer_type: str
    level: int
    xp: int
    expires_at: datetime


class AuthMeResponse(BaseModel):
    user_id: uuid.UUID
    user_name: str
    email: str
    explorer_type: str
    level: int
    xp: int


# Party Schemas
class PartyCreateRequest(BaseModel):
    name: str = Field(default="Mystery Fellowship", max_length=100)
    nickname: str = Field(default="Pathfinder", max_length=50, description="Your explorer nickname shown to partner")


class PartyJoinRequest(BaseModel):
    invite_token: str = Field(..., min_length=10, max_length=100, description="Opaque invitation token")
    nickname: str = Field(default="Wayfarer", max_length=50, description="Your explorer nickname shown to partner")


class ConsentRevealRequest(BaseModel):
    consent: bool = Field(..., description="True to consent to revealing real explorer name, False to revoke")


class PartyMemberPublicResponse(BaseModel):
    user_id: uuid.UUID
    slot_number: int
    role: str
    status: str
    display_name: str
    is_real_name_revealed: bool
    joined_at: datetime
    has_verified: bool = False
    reward_xp_awarded: int = 0


class PartyResponse(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    host_id: uuid.UUID
    created_at: datetime
    members: list[PartyMemberPublicResponse]
    invite_token: str | None = None
    invite_expires_at: datetime | None = None
    has_active_quest: bool = False
    party_quest_id: uuid.UUID | None = None

    model_config = ConfigDict(from_attributes=True)


class PartyStartQuestRequest(BaseModel):
    available_minutes: AvailableMinutesType = Field(default=30)
    explorer_type: ExplorerType = Field(default="mystery")
    difficulty: DifficultyType = Field(default="medium")
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)


class SplitClueResponse(BaseModel):
    id: uuid.UUID
    step_order: int
    clue_title: str
    clue_text: str
    is_revealed: bool
    is_assigned_to_me: bool


class SharedPartyQuestResponse(BaseModel):
    party_id: uuid.UUID
    party_quest_id: uuid.UUID
    quest_id: uuid.UUID
    title: str
    description: str
    difficulty: str
    estimated_minutes: int
    reward_xp: int
    status: str
    my_slot: int
    my_clues: list[SplitClueResponse]
    partner_clues_count: int
    partner_clues_revealed: int
    partner_display_name: str
    partner_verified: bool
    my_verified: bool
    verification_prompt: str | None = None
    destination_name: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class PartyVerifyRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    observation_answer: str = Field(..., min_length=1, max_length=255)


class PartyVerificationResponse(BaseModel):
    success: bool
    message: str
    my_verified: bool
    partner_verified: bool
    quest_completed: bool
    reward_xp_awarded: int
    total_xp: int
    level: int
    destination_name: str | None = None
