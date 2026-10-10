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

        radius = radius_meters if radius_meters is not None else settings.google_places_search_radius_meters
        if not math.isfinite(radius):
            raise ValueError("Search radius must be a finite number")
        if not (settings.google_places_min_radius_meters <= radius <= settings.google_places_max_radius_meters):
            msg = f"Search radius must be between {settings.google_places_min_radius_meters}m and {settings.google_places_max_radius_meters}m, got {radius}m"
            raise ValueError(msg)

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
                # Log status code without leaking full response bodies or API keys
                logger.error(
                    "Google Places searchNearby returned error HTTP %d",
                    response.status_code,
                )
                if response.status_code in (401, 403):
                    raise GooglePlacesError(
                        "Google Places API authentication or permissions failed",
                        status_code=502,
                    )
                raise GooglePlacesError(
                    f"Google Places API request failed with status {response.status_code}",
                    status_code=502,
                )

            try:
                data = response.json()
            except Exception as json_err:
                logger.error("Google Places API returned non-JSON payload: %s", json_err)
                raise GooglePlacesError("Malformed JSON response from Google Places API", status_code=502)

            if not isinstance(data, dict):
                logger.error("Google Places response root is not a JSON object: %s", type(data))
                raise GooglePlacesError("Malformed response structure from Google Places API", status_code=502)

            raw_places = data.get("places")
            if raw_places is None:
                # Google Places returns empty JSON {} when no places are found
                raw_places = []
            elif not isinstance(raw_places, list):
                logger.error("'places' field in Google Places response is not a list: %s", type(raw_places))
                raise GooglePlacesError("Malformed places array in Google Places API response", status_code=502)

            candidates: list[PlaceCandidate] = []
            for item in raw_places:
                if not isinstance(item, dict):
                    continue

                place_id = item.get("id")
                if not place_id or not isinstance(place_id, str) or not place_id.strip():
                    continue

                loc = item.get("location")
                if not isinstance(loc, dict):
                    continue

                raw_lat = loc.get("latitude")
                raw_lon = loc.get("longitude")
                if raw_lat is None or raw_lon is None:
                    continue

                try:
                    place_lat = float(raw_lat)
                    place_lon = float(raw_lon)
                except (ValueError, TypeError):
                    continue

                if not math.isfinite(place_lat) or not math.isfinite(place_lon):
                    continue
                if not (-90.0 <= place_lat <= 90.0) or not (-180.0 <= place_lon <= 180.0):
                    continue

                # Filter out closed places if businessStatus is specified
                business_status = item.get("businessStatus")
                if business_status in ("CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"):
                    continue

                display_name_obj = item.get("displayName")
                name = None
                if isinstance(display_name_obj, dict):
                    raw_text = display_name_obj.get("text")
                    if isinstance(raw_text, str) and raw_text.strip():
                        name = raw_text.strip()

                if not name:
                    continue

                primary_type = item.get("primaryType")
                if not isinstance(primary_type, str) or not primary_type.strip():
                    primary_type = "point_of_interest"

                # Filter out explicitly unsuitable or private types if present
                unsuitable_types = {
                    "private", "parking", "gas_station", "storage",
                    "cemetery", "funeral_home", "prison",
                }
                if primary_type in unsuitable_types:
                    continue

                formatted_address = item.get("formattedAddress")
                if not isinstance(formatted_address, str):
                    formatted_address = None

                # Calculate Haversine distance from search origin
                distance = calculate_haversine_distance_meters(
                    latitude, longitude, place_lat, place_lon
                )

                # Reject candidate if beyond search radius + 15% tolerance
                if distance > (radius * 1.15):
                    continue

                candidate = PlaceCandidate(
                    place_id=place_id.strip(),
                    name=name,
                    latitude=place_lat,
                    longitude=place_lon,
                    primary_type=primary_type,
                    address=formatted_address,
                    business_status=business_status if isinstance(business_status, str) else None,
                    distance_meters=round(distance, 1),
                )
                candidates.append(candidate)

            # Sort by distance
            candidates.sort(key=lambda c: c.distance_meters if c.distance_meters is not None else float("inf"))
            return candidates

        except (httpx.TimeoutException, httpx.ConnectTimeout) as e:
            logger.error("Connection timeout while contacting Google Places API: %s", type(e).__name__)
            raise GooglePlacesError(
                "Connection timeout while contacting Google Places API",
                status_code=504,
            )
        except httpx.RequestError as e:
            logger.error("Network error while connecting to Google Places API: %s", type(e).__name__)
            raise GooglePlacesError(
                "Network error while connecting to Google Places API",
                status_code=504,
            )
