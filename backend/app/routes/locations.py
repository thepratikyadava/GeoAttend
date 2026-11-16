from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.services.geofence import (
    validate_geojson_polygon,
    verify_location_geofence
)


router = APIRouter(
    prefix="/api/locations",
    tags=["Locations and Geofencing"]
)


class LocationCreate(BaseModel):

    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    geofence_type: Literal["circle", "polygon"] = "circle"
    center_latitude: float | None = None
    center_longitude: float | None = None
    radius_meters: float | None = None
    boundary_geojson: dict[str, Any] | None = None
    is_active: bool = True


class LocationUpdate(BaseModel):

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    geofence_type: Literal["circle", "polygon"] | None = None
    center_latitude: float | None = None
    center_longitude: float | None = None
    radius_meters: float | None = None
    boundary_geojson: dict[str, Any] | None = None
    is_active: bool | None = None


class GeofenceTestPayload(BaseModel):

    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


def _prepare_location_record(
    payload: LocationCreate | LocationUpdate,
    existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """
    Validate and normalize circle vs polygon geofence configuration
    so it strictly satisfies the database CHECK constraint
    `valid_geofence_configuration`.
    """
    data = existing.copy() if existing else {}

    name = payload.name if payload.name is not None else data.get("name", "")
    name = name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location name is required"
        )

    description = (
        payload.description.strip()
        if payload.description is not None
        else data.get("description")
    )

    geofence_type = (
        payload.geofence_type
        if payload.geofence_type is not None
        else data.get("geofence_type", "circle")
    )

    is_active = (
        payload.is_active
        if payload.is_active is not None
        else data.get("is_active", True)
    )

    if geofence_type == "circle":
        lat = (
            payload.center_latitude
            if payload.center_latitude is not None
            else data.get("center_latitude")
        )
        lon = (
            payload.center_longitude
            if payload.center_longitude is not None
            else data.get("center_longitude")
        )
        radius = (
            payload.radius_meters
            if payload.radius_meters is not None
            else data.get("radius_meters")
        )

        if lat is None or lon is None or radius is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Circle geofence requires center_latitude, center_longitude, and radius_meters"
            )

        if not (-90.0 <= float(lat) <= 90.0) or not (-180.0 <= float(lon) <= 180.0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid GPS coordinates for circle center"
            )

        if float(radius) <= 0 or float(radius) > 50000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Radius must be between 1 and 50,000 meters"
            )

        return {
            "name": name,
            "description": description or None,
            "geofence_type": "circle",
            "center_latitude": float(lat),
            "center_longitude": float(lon),
            "radius_meters": float(radius),
            "boundary_geojson": None,
            "is_active": bool(is_active)
        }

    elif geofence_type == "polygon":
        boundary = (
            payload.boundary_geojson
            if payload.boundary_geojson is not None
            else data.get("boundary_geojson")
        )
        try:
            normalized_ring = validate_geojson_polygon(boundary)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc)
            ) from exc

        return {
            "name": name,
            "description": description or None,
            "geofence_type": "polygon",
            "center_latitude": None,
            "center_longitude": None,
            "radius_meters": None,
            "boundary_geojson": {
                "type": "Polygon",
                "coordinates": [normalized_ring]
            },
            "is_active": bool(is_active)
        }

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid geofence_type"
    )


@router.get("")
def list_locations(
    active_only: bool = False,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        return {"total": 0, "locations": []}

    query = (
        context.db.table("locations")
        .select("*")
        .eq("institution_id", inst_id)
    )
    if active_only:
        query = query.eq("is_active", True)

    result = query.order("created_at", desc=True).execute()
    locations = result.data or []

    return {
        "total": len(locations),
        "locations": locations
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_location(
    payload: LocationCreate,
    context: AuthContext = Depends(require_admin)
):
    record = _prepare_location_record(payload)
    record["institution_id"] = context.profile["institution_id"]
    record["created_by"] = str(context.user.id)

    result = (
        context.db.table("locations")
        .insert(record)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create location"
        )

    return {
        "message": "Location created successfully",
        "location": result.data[0]
    }


@router.patch("/{location_id}")
@router.put("/{location_id}")
def update_location(
    location_id: str,
    payload: LocationUpdate,
    context: AuthContext = Depends(require_admin)
):
    existing_res = (
        context.db.table("locations")
        .select("*")
        .eq("id", location_id)
        .eq("institution_id", context.profile["institution_id"])
        .limit(1)
        .execute()
    )

    if not existing_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    existing = existing_res.data[0]
    record = _prepare_location_record(payload, existing=existing)

    result = (
        context.db.table("locations")
        .update(record)
        .eq("id", location_id)
        .eq("institution_id", context.profile["institution_id"])
        .execute()
    )

    return {
        "message": "Location updated successfully",
        "location": result.data[0] if result.data else {**existing, **record}
    }


@router.delete("/{location_id}")
def delete_location(
    location_id: str,
    context: AuthContext = Depends(require_admin)
):
    existing_res = (
        context.db.table("locations")
        .select("id, name")
        .eq("id", location_id)
        .eq("institution_id", context.profile["institution_id"])
        .limit(1)
        .execute()
    )

    if not existing_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    context.db.table("locations").delete().eq("id", location_id).execute()

    return {
        "message": "Location deleted successfully",
        "id": location_id
    }


@router.post("/{location_id}/verify")
def test_location_geofence(
    location_id: str,
    payload: GeofenceTestPayload,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not belong to an institution"
        )

    loc_res = (
        context.db.table("locations")
        .select("*")
        .eq("id", location_id)
        .eq("institution_id", inst_id)
        .limit(1)
        .execute()
    )

    if not loc_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    location = loc_res.data[0]
    verification = verify_location_geofence(
        payload.latitude,
        payload.longitude,
        location
    )

    return {
        "location": {
            "id": location["id"],
            "name": location["name"],
            "geofence_type": location["geofence_type"]
        },
        "verification": verification
    }
