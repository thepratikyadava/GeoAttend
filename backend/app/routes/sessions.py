from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.services.background import validate_classroom_samples


router = APIRouter(
    prefix="/api/sessions",
    tags=["Attendance Sessions"]
)


class SessionCreate(BaseModel):

    location_id: str
    name: str = Field(..., min_length=1, max_length=120)
    start_time: datetime
    end_time: datetime
    is_active: bool = True
    classroom_samples: list[dict[str, Any]] | None = None


class SessionUpdate(BaseModel):

    name: str | None = Field(default=None, min_length=1, max_length=120)
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_active: bool | None = None
    classroom_samples: list[dict[str, Any]] | None = None


def _compute_session_timing_status(session_row: dict[str, Any]) -> str:
    if not session_row.get("is_active", True):
        return "closed"

    now = datetime.now(timezone.utc)
    try:
        start = datetime.fromisoformat(
            str(session_row["start_time"]).replace("Z", "+00:00")
        )
        end = datetime.fromisoformat(
            str(session_row["end_time"]).replace("Z", "+00:00")
        )
    except Exception:
        return "active"

    if now < start:
        return "upcoming"
    if now > end:
        return "ended"
    return "ongoing"


@router.get("")
def list_sessions(
    location_id: str | None = None,
    active_only: bool = False,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        return {"total": 0, "sessions": []}

    loc_res = (
        context.db.table("locations")
        .select("*")
        .eq("institution_id", inst_id)
        .execute()
    )
    locations_by_id = {loc["id"]: loc for loc in (loc_res.data or [])}

    if not locations_by_id:
        return {"total": 0, "sessions": []}

    query = context.db.table("sessions").select("*")

    if location_id:
        if location_id not in locations_by_id:
            return {"total": 0, "sessions": []}
        query = query.eq("location_id", location_id)
    else:
        query = query.in_("location_id", list(locations_by_id.keys()))

    if active_only:
        query = query.eq("is_active", True)

    result = query.order("start_time", desc=True).execute()
    sessions = result.data or []

    my_attendance_by_session: dict[str, dict[str, Any]] = {}
    session_counts: dict[str, int] = {}

    if sessions:
        session_ids = [s["id"] for s in sessions]
        att_res = (
            context.db.table("attendance")
            .select("id, session_id, user_id, status, distance_meters, verified_at, latitude, longitude")
            .in_("session_id", session_ids)
            .execute()
        )
        for att in (att_res.data or []):
            sid = att["session_id"]
            session_counts[sid] = session_counts.get(sid, 0) + 1
            if att["user_id"] == str(context.user.id):
                my_attendance_by_session[sid] = att

    enriched_sessions = []
    for s in sessions:
        sid = s["id"]
        samples = s.get("classroom_samples") or []
        session_copy = {k: v for k, v in s.items() if k != "classroom_samples"}
        enriched_sessions.append({
            **session_copy,
            "location": locations_by_id.get(s["location_id"]),
            "timing_status": _compute_session_timing_status(s),
            "attendance_count": session_counts.get(sid, 0),
            "my_attendance": my_attendance_by_session.get(sid),
            "classroom_samples_count": len(samples),
            "requires_background_check": len(samples) >= 3
        })

    return {
        "total": len(enriched_sessions),
        "sessions": enriched_sessions
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreate,
    context: AuthContext = Depends(require_admin)
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session name is required"
        )

    if payload.end_time <= payload.start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session end_time must be after start_time"
        )

    validated_samples = None
    if payload.classroom_samples is not None and len(payload.classroom_samples) > 0:
        try:
            validated_samples = validate_classroom_samples(payload.classroom_samples)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc)
            ) from exc

    loc_res = (
        context.db.table("locations")
        .select("*")
        .eq("id", payload.location_id)
        .eq("institution_id", context.profile["institution_id"])
        .limit(1)
        .execute()
    )

    if not loc_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Selected location not found in your institution"
        )

    location = loc_res.data[0]

    record: dict[str, Any] = {
        "location_id": payload.location_id,
        "name": name,
        "start_time": payload.start_time.astimezone(timezone.utc).isoformat(),
        "end_time": payload.end_time.astimezone(timezone.utc).isoformat(),
        "is_active": payload.is_active,
        "created_by": str(context.user.id)
    }
    if validated_samples is not None:
        record["classroom_samples"] = validated_samples

    result = (
        context.db.table("sessions")
        .insert(record)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create attendance session"
        )

    created = result.data[0]
    created_copy = {k: v for k, v in created.items() if k != "classroom_samples"}
    return {
        "message": "Attendance session created successfully",
        "session": {
            **created_copy,
            "location": location,
            "timing_status": _compute_session_timing_status(created),
            "attendance_count": 0,
            "classroom_samples_count": len(validated_samples or []),
            "requires_background_check": bool(validated_samples)
        }
    }


@router.patch("/{session_id}")
@router.put("/{session_id}")
def update_session(
    session_id: str,
    payload: SessionUpdate,
    context: AuthContext = Depends(require_admin)
):
    existing_res = (
        context.db.table("sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )

    if not existing_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    existing = existing_res.data[0]

    loc_res = (
        context.db.table("locations")
        .select("*")
        .eq("id", existing["location_id"])
        .eq("institution_id", context.profile["institution_id"])
        .limit(1)
        .execute()
    )
    if not loc_res.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to modify this session"
        )

    updates: dict[str, Any] = {}
    if payload.name is not None:
        clean_name = payload.name.strip()
        if not clean_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Session name cannot be empty"
            )
        updates["name"] = clean_name

    if payload.start_time is not None:
        updates["start_time"] = payload.start_time.astimezone(timezone.utc).isoformat()

    if payload.end_time is not None:
        updates["end_time"] = payload.end_time.astimezone(timezone.utc).isoformat()

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    final_start = updates.get("start_time", existing["start_time"])
    final_end = updates.get("end_time", existing["end_time"])

    start_dt = datetime.fromisoformat(str(final_start).replace("Z", "+00:00"))
    end_dt = datetime.fromisoformat(str(final_end).replace("Z", "+00:00"))
    if end_dt <= start_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session end_time must be after start_time"
        )

    result = (
        context.db.table("sessions")
        .update(updates)
        .eq("id", session_id)
        .execute()
    )

    updated = result.data[0] if result.data else {**existing, **updates}

    return {
        "message": "Session updated successfully",
        "session": {
            **updated,
            "location": loc_res.data[0],
            "timing_status": _compute_session_timing_status(updated)
        }
    }


@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    context: AuthContext = Depends(require_admin)
):
    existing_res = (
        context.db.table("sessions")
        .select("id, location_id")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )

    if not existing_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    context.db.table("sessions").delete().eq("id", session_id).execute()

    return {
        "message": "Session deleted successfully",
        "id": session_id
    }
