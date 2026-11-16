import math
from typing import Any


EARTH_RADIUS_METERS = 6371000.0


def haversine_distance_meters(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float
) -> float:
    """
    Calculate the great-circle distance in meters between two GPS points
    using the Haversine formula.
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))

    return round(EARTH_RADIUS_METERS * c, 2)


def point_in_polygon(
    lat: float,
    lon: float,
    ring: list[list[float]]
) -> bool:
    """
    Ray-casting algorithm to determine whether (lon, lat) lies inside
    a GeoJSON polygon exterior ring [[lon, lat], ...].
    """
    if len(ring) < 3:
        return False

    inside = False
    n = len(ring)
    j = n - 1

    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]

        intersects = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i

    return inside


def polygon_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """
    Compute the average (latitude, longitude) center of a GeoJSON polygon ring.
    Ring coordinates are [longitude, latitude].
    """
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    if not pts:
        return (0.0, 0.0)
    avg_lon = sum(p[0] for p in pts) / len(pts)
    avg_lat = sum(p[1] for p in pts) / len(pts)
    return (avg_lat, avg_lon)


def min_distance_to_polygon_vertices(
    lat: float,
    lon: float,
    ring: list[list[float]]
) -> float:
    """
    Calculate the minimum Haversine distance in meters from (lat, lon)
    to any vertex of the GeoJSON polygon ring.
    """
    if not ring:
        return 0.0
    distances = [
        haversine_distance_meters(lat, lon, pt[1], pt[0])
        for pt in ring
        if len(pt) >= 2
    ]
    return min(distances) if distances else 0.0


def validate_geojson_polygon(boundary_geojson: dict[str, Any] | None) -> list[list[float]]:
    """
    Validate a GeoJSON Polygon object and return its exterior coordinate ring.
    Raises ValueError if invalid.
    """
    if not isinstance(boundary_geojson, dict):
        raise ValueError("boundary_geojson must be a valid GeoJSON object")

    if boundary_geojson.get("type") != "Polygon":
        raise ValueError("boundary_geojson type must be 'Polygon'")

    coordinates = boundary_geojson.get("coordinates")
    if (
        not isinstance(coordinates, list)
        or len(coordinates) == 0
        or not isinstance(coordinates[0], list)
    ):
        raise ValueError("Polygon coordinates must contain at least one linear ring")

    ring = coordinates[0]
    if len(ring) < 4:
        raise ValueError("A GeoJSON Polygon ring must have at least 4 coordinates (3 vertices + closing point)")

    normalized_ring: list[list[float]] = []
    for pt in ring:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            raise ValueError("Each polygon coordinate must be [longitude, latitude]")
        lon, lat = float(pt[0]), float(pt[1])
        if not (-180.0 <= lon <= 180.0) or not (-90.0 <= lat <= 90.0):
            raise ValueError("Polygon coordinates out of valid GPS bounds")
        normalized_ring.append([lon, lat])

    if normalized_ring[0] != normalized_ring[-1]:
        normalized_ring.append(list(normalized_ring[0]))

    return normalized_ring


def verify_location_geofence(
    latitude: float,
    longitude: float,
    location: dict[str, Any]
) -> dict[str, Any]:
    """
    Verify whether (latitude, longitude) falls inside a location's geofence.
    Returns verification details including inside status and distance in meters.
    """
    geofence_type = location.get("geofence_type", "circle")

    if geofence_type == "circle":
        center_lat = float(location["center_latitude"])
        center_lon = float(location["center_longitude"])
        radius_meters = float(location["radius_meters"])

        distance_meters = haversine_distance_meters(
            latitude,
            longitude,
            center_lat,
            center_lon
        )
        inside = distance_meters <= radius_meters

        return {
            "inside": inside,
            "geofence_type": "circle",
            "distance_meters": distance_meters,
            "radius_meters": radius_meters,
            "center_latitude": center_lat,
            "center_longitude": center_lon
        }

    elif geofence_type == "polygon":
        boundary = location.get("boundary_geojson") or {}
        ring = validate_geojson_polygon(boundary)
        inside = point_in_polygon(latitude, longitude, ring)
        centroid_lat, centroid_lon = polygon_centroid(ring)

        if inside:
            distance_meters = haversine_distance_meters(
                latitude,
                longitude,
                centroid_lat,
                centroid_lon
            )
        else:
            distance_meters = min_distance_to_polygon_vertices(
                latitude,
                longitude,
                ring
            )

        return {
            "inside": inside,
            "geofence_type": "polygon",
            "distance_meters": distance_meters,
            "radius_meters": None,
            "center_latitude": centroid_lat,
            "center_longitude": centroid_lon
        }

    raise ValueError(f"Unsupported geofence_type: {geofence_type}")
