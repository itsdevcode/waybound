import logging
import math
from typing import Any

import httpx

from app.core.config import settings
from app.core.geo import calculate_haversine_distance_meters
from app.schemas.place import PlaceCandidate

logger = logging.getLogger(__name__)

# Curated public destination types for real-world mystery exploration
EXPLORATION_PLACE_TYPES = [
    "park",
    "tourist_attraction",
    "museum",
    "historical_landmark",
    "monument",
    "art_gallery",
    "cultural_center",
    "botanical_garden",
    "sculpture",
]

# Field mask to strictly control Google Places billing costs:
# Avoids expensive fields (photos, reviews, editorialSummary)
GOOGLE_PLACES_FIELD_MASK = (
    "places.id,"
    "places.displayName,"
    "places.location,"
    "places.primaryType,"
    "places.formattedAddress,"
    "places.businessStatus"
)


class GooglePlacesError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class GooglePlacesService:
    """
    Service for discovering real nearby public destinations using Google Places API (New).
    Endpoint: POST https://places.googleapis.com/v1/places:searchNearby
    """

    def __init__(
        self,
        api_key: str | None = None,
        timeout_seconds: float | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key or settings.google_maps_api_key
        self.timeout_seconds = timeout_seconds or settings.google_places_timeout_seconds
        self.client = client

    async def search_nearby_places(
        self,
        latitude: float,
        longitude: float,
        radius_meters: float | None = None,
        included_types: list[str] | None = None,
        max_results: int = 10,
    ) -> list[PlaceCandidate]:
        """
        Discovers nearby public places, validates coordinates, and returns normalized PlaceCandidates
        ordered by distance.
        """
        # Validate coordinates
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            raise ValueError("Coordinates must be valid finite numbers")
        if not (-90.0 <= latitude <= 90.0):
            raise ValueError(f"Latitude must be between -90 and 90, got {latitude}")
        if not (-180.0 <= longitude <= 180.0):
            raise ValueError(f"Longitude must be between -180 and 180, got {longitude}")

        if not self.api_key:
            raise GooglePlacesError(
                "Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY.",
                status_code=500,
            )

        radius = radius_meters or settings.google_places_search_radius_meters
        types = included_types or EXPLORATION_PLACE_TYPES

        url = "https://places.googleapis.com/v1/places:searchNearby"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
        }

        body: dict[str, Any] = {
            "includedTypes": types,
            "maxResultCount": min(max(max_results, 1), 20),
            "locationRestriction": {
                "circle": {
                    "center": {
                        "latitude": latitude,
                        "longitude": longitude,
                    },
                    "radius": float(radius),
                }
            },
        }

        try:
            if self.client:
                response = await self.client.post(
                    url, json=body, headers=headers, timeout=self.timeout_seconds
                )
            else:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        url, json=body, headers=headers, timeout=self.timeout_seconds
                    )

            if response.status_code != 200:
                logger.error(
                    "Google Places searchNearby failed with HTTP %d: %s",
                    response.status_code,
                    response.text,
                )
                raise GooglePlacesError(
                    f"Google Places API request failed with status {response.status_code}",
                    status_code=502,
                )

            data = response.json()
            raw_places = data.get("places", [])

            candidates: list[PlaceCandidate] = []
            for item in raw_places:
                loc = item.get("location")
                if not loc:
                    continue

                place_lat = loc.get("latitude")
                place_lon = loc.get("longitude")
                if place_lat is None or place_lon is None:
                    continue

                # Filter out closed places if businessStatus is specified
                business_status = item.get("businessStatus")
                if business_status in ("CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"):
                    continue

                display_name_obj = item.get("displayName", {})
                name = display_name_obj.get("text", "Unknown Place")
                primary_type = item.get("primaryType", "point_of_interest")
                formatted_address = item.get("formattedAddress")
                place_id = item.get("id")

                if not place_id or not name:
                    continue

                # Calculate Haversine distance from search origin
                distance = calculate_haversine_distance_meters(
                    latitude, longitude, float(place_lat), float(place_lon)
                )

                candidate = PlaceCandidate(
                    place_id=place_id,
                    name=name,
                    latitude=float(place_lat),
                    longitude=float(place_lon),
                    primary_type=primary_type,
                    address=formatted_address,
                    business_status=business_status,
                    distance_meters=round(distance, 1),
                )
                candidates.append(candidate)

            # Sort by distance
            candidates.sort(key=lambda c: c.distance_meters if c.distance_meters is not None else float("inf"))
            return candidates

        except httpx.RequestError as e:
            logger.error("Network error while connecting to Google Places API: %s", e)
            raise GooglePlacesError(
                f"Failed to connect to Google Places API: {str(e)}",
                status_code=504,
            )
