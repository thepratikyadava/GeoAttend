import uuid
from datetime import datetime, timezone, timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.local_store import load_store, save_store
from app.routes.locations import get_institution_locations
from app.routes.sessions import (
    get_institution_sessions,
    get_session_attendance_records
)
from app.services.geofence import verify_location_geofence


router = APIRouter(
    prefix="/api/attendance",
    tags=["Attendance Verification and Records"]
)


LATE_THRESHOLD_MINUTES = 15


class AttendanceMarkPayload(BaseModel):

    session_id: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_meters: float | None = Field(default=None, ge=0.0)


@router.post("/mark", status_code=status.HTTP_201_CREATED)
def mark_attendance(
    payload: AttendanceMarkPayload,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not associated with an institution"
        )

    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}
    sessions = get_institution_sessions(context, locations_by_id)
    session_row = next((s for s in sessions if s["id"] == payload.session_id), None)

    if not session_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance session not found"
        )

    if not session_row.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This attendance session is currently closed"
        )

    location = locations_by_id.get(session_row["location_id"])
    if not location:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Session location does not belong to your institution"
        )

    if not location.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The location for this session is currently inactive"
        )

    now = datetime.now(timezone.utc)
    start_time = datetime.fromisoformat(
        str(session_row["start_time"]).replace("Z", "+00:00")
    )
    end_time = datetime.fromisoformat(
        str(session_row["end_time"]).replace("Z", "+00:00")
    )

    if now < start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session has not started yet (starts at {start_time.isoformat()})"
        )

    if now > end_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This attendance session has already ended"
        )

    uid = str(context.user.id)
    existing_records = get_session_attendance_records(context, [payload.session_id])
    if any(r.get("user_id") == uid for r in existing_records):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already marked attendance for this session"
        )

    verification = verify_location_geofence(
        payload.latitude,
        payload.longitude,
        location
    )

    if not verification["inside"]:
        if verification["geofence_type"] == "circle":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Outside geofence boundary: you are {verification['distance_meters']}m "
                    f"from {location['name']} (allowed radius: {verification['radius_meters']}m)"
                )
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Outside polygon geofence boundary for {location['name']} "
                    f"(nearest vertex distance: {verification['distance_meters']}m)"
                )
            )

    session_duration_seconds = max(60.0, (end_time - start_time).total_seconds())
    grace_seconds = min(
        LATE_THRESHOLD_MINUTES * 60.0,
        max(300.0, session_duration_seconds * 0.35)
    )
    late_cutoff = start_time + timedelta(seconds=grace_seconds)
    attendance_status = "present" if now <= late_cutoff else "late"

    record = {
        "session_id": payload.session_id,
        "user_id": uid,
        "latitude": float(payload.latitude),
        "longitude": float(payload.longitude),
        "gps_accuracy_meters": (
            float(payload.gps_accuracy_meters)
            if payload.gps_accuracy_meters is not None
            else None
        ),
        "distance_meters": float(verification["distance_meters"]),
        "status": attendance_status
    }

    saved = None
    if context.db is not None:
        try:
            insert_res = context.db.table("attendance").insert(record).execute()
            if insert_res.data:
                saved = insert_res.data[0]
        except Exception:
            saved = None

    now_iso = now.isoformat()
    if not saved:
        saved = {
            "id": str(uuid.uuid4()),
            **record,
            "verified_at": now_iso,
            "created_at": now_iso
        }

    store = load_store()
    store.setdefault("attendance", []).insert(0, saved)
    save_store(store)

    return {
        "message": f"Attendance verified and marked as {attendance_status.upper()}",
        "attendance": {
            **saved,
            "session": {
                "id": session_row["id"],
                "name": session_row["name"],
                "start_time": session_row["start_time"],
                "end_time": session_row["end_time"]
            },
            "location": {
                "id": location["id"],
                "name": location["name"],
                "geofence_type": location["geofence_type"],
                "radius_meters": location.get("radius_meters")
            }
        },
        "verification": verification
    }


@router.get("/me")
def get_my_attendance(
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        return {
            "total": 0,
            "summary": {
                "total_sessions": 0,
                "attended": 0,
                "present": 0,
                "late": 0,
                "missed": 0,
                "attendance_rate": 0.0
            },
            "records": []
        }

    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}
    sessions = get_institution_sessions(context, locations_by_id)
    sessions_by_id = {s["id"]: s for s in sessions}

    all_records = get_session_attendance_records(context, list(sessions_by_id.keys()))
    uid = str(context.user.id)
    records = [r for r in all_records if r.get("user_id") == uid]

    enriched = []
    present_count = 0
    late_count = 0

    for r in records:
        if r.get("status") == "present":
            present_count += 1
        elif r.get("status") == "late":
            late_count += 1

        sess = sessions_by_id.get(r["session_id"])
        loc = locations_by_id.get(sess["location_id"]) if sess else None

        enriched.append({
            **r,
            "session": sess,
            "location": loc
        })

    total_sessions = len(sessions_by_id)
    attended = len(records)
    missed = max(0, total_sessions - attended)
    rate = round((attended / total_sessions) * 100.0, 1) if total_sessions > 0 else 0.0

    return {
        "total": attended,
        "summary": {
            "total_sessions": total_sessions,
            "attended": attended,
            "present": present_count,
            "late": late_count,
            "missed": missed,
            "attendance_rate": rate
        },
        "records": enriched
    }


@router.get("/all")
def list_institution_attendance(
    session_id: str | None = None,
    location_id: str | None = None,
    status_filter: str | None = None,
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}

    sessions = get_institution_sessions(
        context,
        locations_by_id,
        location_id=location_id
    )
    sessions_by_id = {s["id"]: s for s in sessions}

    if not sessions_by_id:
        return {"total": 0, "records": []}

    store = load_store()
    users_by_id: dict[str, dict[str, Any]] = {
        uid: prof for uid, prof in store.get("profiles", {}).items()
    }
    if context.db is not None:
        try:
            users_res = (
                context.db.table("profiles")
                .select("id, full_name, role")
                .eq("institution_id", inst_id)
                .execute()
            )
            for u in (users_res.data or []):
                if u["id"] not in users_by_id:
                    users_by_id[u["id"]] = u
        except Exception:
            pass

    target_sids = [session_id] if session_id else list(sessions_by_id.keys())
    records = get_session_attendance_records(context, target_sids)

    if status_filter in ("present", "late"):
        records = [r for r in records if r.get("status") == status_filter]

    enriched = []
    for r in records:
        sess = sessions_by_id.get(r["session_id"])
        loc = locations_by_id.get(sess["location_id"]) if sess else None
        student = users_by_id.get(r["user_id"])
        enriched.append({
            **r,
            "student_name": student.get("full_name") if student else "Student",
            "student_role": student.get("role") if student else "student",
            "session_name": sess.get("name") if sess else "Session",
            "session_start_time": sess.get("start_time") if sess else None,
            "location_id": loc.get("id") if loc else None,
            "location_name": loc.get("name") if loc else "Location"
        })

    return {
        "total": len(enriched),
        "records": enriched
    }
