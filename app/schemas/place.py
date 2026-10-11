from pydantic import BaseModel, ConfigDict, Field


class PlaceCandidate(BaseModel):
    place_id: str = Field(..., description="Google Place ID")
    name: str = Field(..., description="Destination display name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude")
    primary_type: str = Field(..., description="Primary place type")
    address: str | None = Field(default=None, description="Formatted address if available")
    business_status: str | None = Field(default=None, description="Operational status if available")
    distance_meters: float | None = Field(default=None, description="Distance from origin in meters")

    model_config = ConfigDict(from_attributes=True)


class CitySuggestion(BaseModel):
    name: str = Field(..., description="City or locality name")
    region: str = Field(default="", description="State, district or administrative region")
    country: str = Field(default="", description="Country name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude")
    place_id: str | None = Field(default=None, description="Optional Google Place ID")
    distance_km: float | None = Field(default=None, description="Distance from search origin in kilometers")

    model_config = ConfigDict(from_attributes=True)
