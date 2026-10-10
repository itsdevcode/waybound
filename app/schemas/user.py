import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr


class ProfileResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    explorer_type: str
    level: int
    xp: int
    social_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    created_at: datetime
    updated_at: datetime
    profile: ProfileResponse | None = None

    model_config = ConfigDict(from_attributes=True)
