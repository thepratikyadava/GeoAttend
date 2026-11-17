from datetime import datetime, timezone, timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.services.geofence import verify_location_geofence
from app.services.face import verify_face_descriptor
from app.services.background import verify_classroom_background


router = APIRouter(
    prefix="/api/attendance",
    tags=["Attendance Verification and Records"]
)


LATE_THRESHOLD_MINUTES = 15


class LocationPrecheckPayload(BaseModel):

    session_id: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_meters: float | None = Field(default=None, ge=0.0)


class AttendanceMarkPayload(BaseModel):

    session_id: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_meters: float | None = Field(default=None, ge=0.0)
    face_descriptor: list[float]
    background_signature: list[float] | None = None


def _validate_session_and_location(
    payload: LocationPrecheckPayload | AttendanceMarkPayload,
    context: AuthContext
) -> tuple[dict[str, Any], dict[str, Any], datetime, datetime, dict[str, Any]]:
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not associated with an institution"
        )

    session_res = (
        context.db.table("sessions")
        .select("*")
        .eq("id", payload.session_id)
        .limit(1)
        .execute()
    )

    if not session_res.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance session not found"
        )

    session_row = session_res.data[0]

    if not session_row.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This attendance session is currently closed"
        )

    loc_res = (
        context.db.table("locations")
        .select("*")
        .eq("id", session_row["location_id"])
        .eq("institution_id", inst_id)
        .limit(1)
        .execute()
    )

    if not loc_res.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Session location does not belong to your institution"
        )

    location = loc_res.data[0]
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

    existing_att = (
        context.db.table("attendance")
        .select("id, status, verified_at, distance_meters")
        .eq("session_id", payload.session_id)
        .eq("user_id", str(context.user.id))
        .limit(1)
        .execute()
    )

    if existing_att.data:
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

    return session_row, location, start_time, end_time, verification


@router.post("/verify-location")
def verify_attendance_location(
    payload: LocationPrecheckPayload,
    context: AuthContext = Depends(get_current_context)
):
    """
    Step 1 of attendance check-in:
    Verify session window and confirm the student is inside the geofence boundary
    before launching facial verification.
    """
    session_row, location, _, _, verification = _validate_session_and_location(
        payload,
        context
    )

    user_meta = getattr(context.user, "user_metadata", None) or {}
    has_face = bool(
        context.profile.get("face_descriptor")
        or user_meta.get("face_descriptor")
    )

    return {
        "inside": True,
        "has_face_registered": has_face,
        "session_id": session_row["id"],
        "location_name": location["name"],
        "verification": verification
    }


@router.post("/mark", status_code=status.HTTP_201_CREATED)
def mark_attendance(
    payload: AttendanceMarkPayload,
    context: AuthContext = Depends(get_current_context)
):
    """
    Step 2 of attendance check-in:
    1. Re-verify session window & geofence boundary.
    2. Verify live facial descriptor against the user's registered facial record.
    3. Record verified attendance.
    """
    session_row, location, start_time, end_time, verification = (
        _validate_session_and_location(payload, context)
    )

    user_meta = getattr(context.user, "user_metadata", None) or {}
    stored_face = (
        context.profile.get("face_descriptor")
        or user_meta.get("face_descriptor")
    )
    if not stored_face:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Facial data is not registered on your profile. Please register your Face ID first."
        )

    try:
        face_result = verify_face_descriptor(
            stored_face,
            payload.face_descriptor
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid facial capture data: {str(exc)}"
        ) from exc

    if not face_result["matched"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Facial verification failed (match distance {face_result['distance']} "
                f"exceeds threshold {face_result['threshold']}). Please try again in good lighting."
            )
        )

    # Verify classroom background if session has classroom samples configured
    classroom_samples = session_row.get("classroom_samples") or []
    background_verified = False
    background_similarity = None
    background_result = None

    if len(classroom_samples) >= 3:
        if not payload.background_signature:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Classroom background verification is required for this session."
            )
        try:
            background_result = verify_classroom_background(
                classroom_samples,
                payload.background_signature
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid classroom background signature: {str(exc)}"
            ) from exc

        if not background_result["matched"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Classroom background did not match session samples "
                    f"(similarity {background_result['similarity']} < {background_result['threshold']}). "
                    f"Ensure you are inside the classroom."
                )
            )
        background_verified = True
        background_similarity = float(background_result["similarity"])

    now = datetime.now(timezone.utc)
    session_duration_seconds = max(60.0, (end_time - start_time).total_seconds())
    grace_seconds = min(
        LATE_THRESHOLD_MINUTES * 60.0,
        max(300.0, session_duration_seconds * 0.35)
    )
    late_cutoff = start_time + timedelta(seconds=grace_seconds)
    attendance_status = "present" if now <= late_cutoff else "late"

    record = {
        "session_id": payload.session_id,
        "user_id": str(context.user.id),
        "latitude": float(payload.latitude),
        "longitude": float(payload.longitude),
        "gps_accuracy_meters": (
            float(payload.gps_accuracy_meters)
            if payload.gps_accuracy_meters is not None
            else None
        ),
        "distance_meters": float(verification["distance_meters"]),
        "status": attendance_status,
        "face_verified": True,
        "face_match_distance": float(face_result["distance"]),
        "background_verified": background_verified,
        "background_similarity": background_similarity
    }

    insert_res = (
        context.db.table("attendance")
        .insert(record)
        .execute()
    )

    if not insert_res.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save attendance record"
        )

    saved = insert_res.data[0]
    return {
        "message": (
            f"Location, Face & Classroom verified — marked as {attendance_status.upper()}"
            if background_verified
            else f"Location & Face verified — marked as {attendance_status.upper()}"
        ),
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
        "verification": verification,
        "face_verification": face_result,
        "background_verification": background_result
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

    loc_res = (
        context.db.table("locations")
        .select("id, name, geofence_type, radius_meters, center_latitude, center_longitude")
        .eq("institution_id", inst_id)
        .execute()
    )
    locations_by_id = {loc["id"]: loc for loc in (loc_res.data or [])}

    sessions_by_id: dict[str, dict[str, Any]] = {}
    if locations_by_id:
        sess_res = (
            context.db.table("sessions")
            .select("*")
            .in_("location_id", list(locations_by_id.keys()))
            .execute()
        )
        sessions_by_id = {s["id"]: s for s in (sess_res.data or [])}

    att_res = (
        context.db.table("attendance")
        .select("*")
        .eq("user_id", str(context.user.id))
        .order("verified_at", desc=True)
        .execute()
    )
    records = att_res.data or []

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

    loc_res = (
        context.db.table("locations")
        .select("id, name, geofence_type, radius_meters")
        .eq("institution_id", inst_id)
        .execute()
    )
    locations_by_id = {loc["id"]: loc for loc in (loc_res.data or [])}

    if not locations_by_id:
        return {"total": 0, "records": []}

    sess_query = (
        context.db.table("sessions")
        .select("*")
        .in_("location_id", list(locations_by_id.keys()))
    )
    if location_id:
        sess_query = sess_query.eq("location_id", location_id)

    sess_res = sess_query.execute()
    sessions_by_id = {s["id"]: s for s in (sess_res.data or [])}

    if not sessions_by_id:
        return {"total": 0, "records": []}

    users_res = (
        context.db.table("profiles")
        .select("id, full_name, role")
        .eq("institution_id", inst_id)
        .execute()
    )
    users_by_id = {u["id"]: u for u in (users_res.data or [])}

    att_query = (
        context.db.table("attendance")
        .select("*")
        .in_("session_id", list(sessions_by_id.keys()))
    )

    if session_id:
        att_query = att_query.eq("session_id", session_id)
    if status_filter in ("present", "late"):
        att_query = att_query.eq("status", status_filter)

    att_res = att_query.order("verified_at", desc=True).execute()
    records = att_res.data or []

    enriched = []
    for r in records:
        sess = sessions_by_id.get(r["session_id"])
        loc = locations_by_id.get(sess["location_id"]) if sess else None
        student = users_by_id.get(r["user_id"])
        enriched.append({
            **r,
            "student_name": student.get("full_name") if student else "Unknown Student",
            "student_role": student.get("role") if student else "student",
            "session_name": sess.get("name") if sess else "Unknown Session",
            "session_start_time": sess.get("start_time") if sess else None,
            "location_id": loc.get("id") if loc else None,
            "location_name": loc.get("name") if loc else "Unknown Location"
        })

    return {
        "total": len(enriched),
        "records": enriched
    }
