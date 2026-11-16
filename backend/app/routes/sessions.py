import uuid
from datetime import datetime, timezone
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


class SessionUpdate(BaseModel):

    name: str | None = Field(default=None, min_length=1, max_length=120)
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_active: bool | None = None


def compute_session_timing_status(session_row: dict[str, Any]) -> str:
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
        return "ongoing"

    if now < start:
        return "upcoming"
    if now > end:
        return "ended"
    return "ongoing"


def get_institution_sessions(
    context: AuthContext,
    locations_by_id: dict[str, dict[str, Any]],
    location_id: str | None = None,
    active_only: bool = False
) -> list[dict[str, Any]]:
    if not locations_by_id:
        return []

    store = load_store()
    by_id: dict[str, dict[str, Any]] = {}

    for s in store.get("sessions", []):
        lid = s.get("location_id")
        if lid in locations_by_id:
            if location_id and lid != location_id:
                continue
            if active_only and not s.get("is_active", True):
                continue
            by_id[s["id"]] = s

    if context.db is not None:
        try:
            query = context.db.table("sessions").select("*")
            if location_id:
                query = query.eq("location_id", location_id)
            else:
                query = query.in_("location_id", list(locations_by_id.keys()))
            if active_only:
                query = query.eq("is_active", True)
            res = query.order("start_time", desc=True).execute()
            for row in (res.data or []):
                by_id[row["id"]] = row
        except Exception:
            pass

    sessions = list(by_id.values())
    sessions.sort(key=lambda x: str(x.get("start_time", "")), reverse=True)
    return sessions


def get_session_attendance_records(
    context: AuthContext,
    session_ids: list[str]
) -> list[dict[str, Any]]:
    if not session_ids:
        return []

    store = load_store()
    by_id: dict[str, dict[str, Any]] = {}
    session_set = set(session_ids)

    for att in store.get("attendance", []):
        if att.get("session_id") in session_set:
            by_id[att["id"]] = att

    if context.db is not None:
        try:
            res = (
                context.db.table("attendance")
                .select("*")
                .in_("session_id", session_ids)
                .execute()
            )
            for row in (res.data or []):
                by_id[row["id"]] = row
        except Exception:
            pass

    records = list(by_id.values())
    records.sort(key=lambda x: str(x.get("verified_at", "")), reverse=True)
    return records


@router.get("")
def list_sessions(
    location_id: str | None = None,
    active_only: bool = False,
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    if not inst_id:
        return {"total": 0, "sessions": []}

    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}

    sessions = get_institution_sessions(
        context,
        locations_by_id,
        location_id=location_id,
        active_only=active_only
    )

    my_attendance_by_session: dict[str, dict[str, Any]] = {}
    session_counts: dict[str, int] = {}

    if sessions:
        session_ids = [s["id"] for s in sessions]
        att_records = get_session_attendance_records(context, session_ids)
        for att in att_records:
            sid = att["session_id"]
            session_counts[sid] = session_counts.get(sid, 0) + 1
            if att["user_id"] == str(context.user.id):
                my_attendance_by_session[sid] = att

    enriched_sessions = []
    for s in sessions:
        sid = s["id"]
        enriched_sessions.append({
            **s,
            "location": locations_by_id.get(s["location_id"]),
            "timing_status": compute_session_timing_status(s),
            "attendance_count": session_counts.get(sid, 0),
            "my_attendance": my_attendance_by_session.get(sid)
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

    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    location = next((loc for loc in locations if loc["id"] == payload.location_id), None)

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Selected location not found in your institution"
        )

    record = {
        "location_id": payload.location_id,
        "name": name,
        "start_time": payload.start_time.astimezone(timezone.utc).isoformat(),
        "end_time": payload.end_time.astimezone(timezone.utc).isoformat(),
        "is_active": payload.is_active,
        "created_by": str(context.user.id)
    }

    created = None
    if context.db is not None:
        try:
            res = context.db.table("sessions").insert(record).execute()
            if res.data:
                created = res.data[0]
        except Exception:
            created = None

    if not created:
        created = {
            "id": str(uuid.uuid4()),
            **record,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

    store = load_store()
    store.setdefault("sessions", []).insert(0, created)
    save_store(store)

    return {
        "message": "Attendance session created successfully",
        "session": {
            **created,
            "location": location,
            "timing_status": compute_session_timing_status(created),
            "attendance_count": 0
        }
    }


@router.patch("/{session_id}")
@router.put("/{session_id}")
def update_session(
    session_id: str,
    payload: SessionUpdate,
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}
    sessions = get_institution_sessions(context, locations_by_id)
    existing = next((s for s in sessions if s["id"] == session_id), None)

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
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

    updated = {**existing, **updates}

    if context.db is not None:
        try:
            context.db.table("sessions").update(updates).eq("id", session_id).execute()
        except Exception:
            pass

    store = load_store()
    store_sessions = store.setdefault("sessions", [])
    replaced = False
    for idx, s in enumerate(store_sessions):
        if s.get("id") == session_id:
            store_sessions[idx] = updated
            replaced = True
            break
    if not replaced:
        store_sessions.append(updated)
    save_store(store)

    return {
        "message": "Session updated successfully",
        "session": {
            **updated,
            "location": locations_by_id.get(updated["location_id"]),
            "timing_status": compute_session_timing_status(updated)
        }
    }


@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}
    sessions = get_institution_sessions(context, locations_by_id)
    existing = next((s for s in sessions if s["id"] == session_id), None)

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    if context.db is not None:
        try:
            context.db.table("sessions").delete().eq("id", session_id).execute()
        except Exception:
            pass

    store = load_store()
    store["sessions"] = [
        s for s in store.get("sessions", []) if s.get("id") != session_id
    ]
    store["attendance"] = [
        a for a in store.get("attendance", []) if a.get("session_id") != session_id
    ]
    save_store(store)

    return {
        "message": "Session deleted successfully",
        "id": session_id
    }
