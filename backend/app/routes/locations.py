import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.local_store import load_store, save_store
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


def get_institution_locations(context: AuthContext, inst_id: str, active_only: bool = False) -> list[dict[str, Any]]:
    store = load_store()
    by_id: dict[str, dict[str, Any]] = {}

    for loc in store.get("locations", []):
        if loc.get("institution_id") == inst_id:
            if not active_only or loc.get("is_active", True):
                by_id[loc["id"]] = loc

    if context.db is not None:
        try:
            query = context.db.table("locations").select("*").eq("institution_id", inst_id)
            if active_only:
                query = query.eq("is_active", True)
            res = query.order("created_at", desc=True).execute()
            for row in (res.data or []):
                by_id[row["id"]] = row
        except Exception:
            pass

    locations = list(by_id.values())
    locations.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
    return locations


@router.get("")
def list_locations(
    active_only: bool = False,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        return {"total": 0, "locations": []}

    locations = get_institution_locations(context, inst_id, active_only=active_only)
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

    created = None
    if context.db is not None:
        try:
            res = context.db.table("locations").insert(record).execute()
            if res.data:
                created = res.data[0]
        except Exception:
            created = None

    now_iso = datetime.now(timezone.utc).isoformat()
    if not created:
        created = {
            "id": str(uuid.uuid4()),
            **record,
            "created_at": now_iso,
            "updated_at": now_iso
        }

    store = load_store()
    store.setdefault("locations", []).insert(0, created)
    save_store(store)

    return {
        "message": "Location created successfully",
        "location": created
    }


@router.patch("/{location_id}")
@router.put("/{location_id}")
def update_location(
    location_id: str,
    payload: LocationUpdate,
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    existing = next((loc for loc in locations if loc["id"] == location_id), None)

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    record = _prepare_location_record(payload, existing=existing)
    updated = {
        **existing,
        **record,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    if context.db is not None:
        try:
            context.db.table("locations").update(record).eq("id", location_id).execute()
        except Exception:
            pass

    store = load_store()
    store_locs = store.setdefault("locations", [])
    replaced = False
    for idx, loc in enumerate(store_locs):
        if loc.get("id") == location_id:
            store_locs[idx] = updated
            replaced = True
            break
    if not replaced:
        store_locs.append(updated)
    save_store(store)

    return {
        "message": "Location updated successfully",
        "location": updated
    }


@router.delete("/{location_id}")
def delete_location(
    location_id: str,
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    existing = next((loc for loc in locations if loc["id"] == location_id), None)

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

    if context.db is not None:
        try:
            context.db.table("locations").delete().eq("id", location_id).execute()
        except Exception:
            pass

    store = load_store()
    store["locations"] = [
        loc for loc in store.get("locations", []) if loc.get("id") != location_id
    ]
    store["sessions"] = [
        s for s in store.get("sessions", []) if s.get("location_id") != location_id
    ]
    save_store(store)

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

    locations = get_institution_locations(context, inst_id)
    location = next((loc for loc in locations if loc["id"] == location_id), None)

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found"
        )

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
