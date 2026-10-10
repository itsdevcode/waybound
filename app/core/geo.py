import math


def calculate_haversine_distance_meters(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """
    Calculate the great-circle distance between two geographic points
    on Earth using the Haversine formula.

    Returns the distance in meters.
    Raises ValueError for non-finite coordinates.
    """
    for val in (lat1, lon1, lat2, lon2):
        if not math.isfinite(val):
            raise ValueError("Geographic coordinates must be finite real numbers.")

    for lat in (lat1, lat2):
        if not (-90.0 <= lat <= 90.0):
            raise ValueError(f"Latitude must be between -90 and 90 degrees, got {lat}.")

    for lon in (lon1, lon2):
        if not (-180.0 <= lon <= 180.0):
            raise ValueError(f"Longitude must be between -180 and 180 degrees, got {lon}.")

    r = 6_371_000.0  # Earth's mean radius in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    # Clamp 'a' between 0 and 1 to prevent domain errors with float inaccuracies
    a = min(1.0, max(0.0, a))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return r * c


def calculate_profile_level(total_xp: int) -> int:
    """
    Single source of truth for explorer profile level calculation.
    level = 1 + (total_xp // 500)
    """
    if total_xp < 0:
        return 1
    return 1 + (total_xp // 500)
