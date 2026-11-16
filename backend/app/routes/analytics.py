from collections import defaultdict
from typing import Any
from fastapi import APIRouter, Depends

from app.auth import (
    AuthContext,
    require_admin
)
from app.local_store import load_store
from app.routes.locations import get_institution_locations
from app.routes.sessions import (
    get_institution_sessions,
    get_session_attendance_records
)


router = APIRouter(
    prefix="/api/analytics",
    tags=["Analytics and Reports"]
)


@router.get("/overview")
def get_analytics_overview(
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]

    # 1. Institution users
    store = load_store()
    users_by_id: dict[str, dict[str, Any]] = {}
    for uid, prof in store.get("profiles", {}).items():
        if prof.get("institution_id") == inst_id:
            users_by_id[uid] = prof

    if context.db is not None:
        try:
            users_res = (
                context.db.table("profiles")
                .select("id, full_name, role, created_at")
                .eq("institution_id", inst_id)
                .execute()
            )
            for u in (users_res.data or []):
                if u["id"] not in users_by_id:
                    users_by_id[u["id"]] = u
        except Exception:
            pass

    all_users = list(users_by_id.values())
    students = [u for u in all_users if u.get("role") == "student"]
    total_students = len(students)

    # 2. Locations
    locations = get_institution_locations(context, inst_id)
    locations_by_id = {loc["id"]: loc for loc in locations}

    # 3. Sessions
    sessions = get_institution_sessions(context, locations_by_id)
    sessions.sort(key=lambda x: str(x.get("start_time", "")))
    sessions_by_id = {s["id"]: s for s in sessions}

    # 4. Attendance records
    attendance_records = get_session_attendance_records(
        context,
        list(sessions_by_id.keys())
    )

    present_count = sum(1 for a in attendance_records if a.get("status") == "present")
    late_count = sum(1 for a in attendance_records if a.get("status") == "late")
    total_records = len(attendance_records)

    total_possible = max(1, total_students) * len(sessions)
    overall_attendance_rate = (
        round((total_records / total_possible) * 100.0, 1)
        if total_possible > 0 and len(sessions) > 0
        else 0.0
    )

    # 5. Per-session breakdown
    att_by_session: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in attendance_records:
        att_by_session[a["session_id"]].append(a)

    session_breakdown = []
    for s in sessions:
        sid = s["id"]
        recs = att_by_session.get(sid, [])
        s_present = sum(1 for r in recs if r.get("status") == "present")
        s_late = sum(1 for r in recs if r.get("status") == "late")
        s_attended = len(recs)
        s_absent = max(0, total_students - s_attended)
        s_rate = (
            round((s_attended / total_students) * 100.0, 1)
            if total_students > 0
            else 0.0
        )
        loc = locations_by_id.get(s["location_id"], {})
        session_breakdown.append({
            "session_id": sid,
            "session_name": s["name"],
            "location_name": loc.get("name", "Unknown"),
            "start_time": s["start_time"],
            "present": s_present,
            "late": s_late,
            "attended": s_attended,
            "absent": s_absent,
            "attendance_rate": s_rate
        })

    # 6. Per-location breakdown
    sessions_by_location: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for s in sessions:
        sessions_by_location[s["location_id"]].append(s)

    location_breakdown = []
    for loc in locations:
        lid = loc["id"]
        loc_sessions = sessions_by_location.get(lid, [])
        loc_att_count = sum(len(att_by_session.get(s["id"], [])) for s in loc_sessions)
        location_breakdown.append({
            "location_id": lid,
            "location_name": loc["name"],
            "geofence_type": loc["geofence_type"],
            "is_active": loc["is_active"],
            "sessions_count": len(loc_sessions),
            "attendance_count": loc_att_count
        })

    # 7. Student attendance report table
    att_by_student: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in attendance_records:
        att_by_student[a["user_id"]].append(a)

    student_reports = []
    total_sessions_count = len(sessions)
    for st in students:
        uid = st["id"]
        st_recs = att_by_student.get(uid, [])
        st_present = sum(1 for r in st_recs if r.get("status") == "present")
        st_late = sum(1 for r in st_recs if r.get("status") == "late")
        st_attended = len(st_recs)
        st_missed = max(0, total_sessions_count - st_attended)
        st_rate = (
            round((st_attended / total_sessions_count) * 100.0, 1)
            if total_sessions_count > 0
            else 0.0
        )
        student_reports.append({
            "student_id": uid,
            "full_name": st.get("full_name") or "Unnamed Student",
            "present": st_present,
            "late": st_late,
            "attended": st_attended,
            "missed": st_missed,
            "total_sessions": total_sessions_count,
            "attendance_rate": st_rate
        })

    student_reports.sort(key=lambda x: x["attendance_rate"], reverse=True)

    # 8. Daily trend aggregation
    daily_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"present": 0, "late": 0, "total": 0}
    )
    for a in attendance_records:
        verified_str = str(a.get("verified_at", ""))[:10]
        if verified_str:
            daily_map[verified_str]["total"] += 1
            if a.get("status") == "present":
                daily_map[verified_str]["present"] += 1
            else:
                daily_map[verified_str]["late"] += 1

    daily_trends = [
        {
            "date": day,
            "present": counts["present"],
            "late": counts["late"],
            "total": counts["total"]
        }
        for day, counts in sorted(daily_map.items())
    ]

    return {
        "kpis": {
            "total_students": total_students,
            "total_admins": len(all_users) - total_students,
            "total_locations": len(locations),
            "active_locations": sum(1 for loc in locations if loc.get("is_active")),
            "total_sessions": len(sessions),
            "active_sessions": sum(1 for s in sessions if s.get("is_active")),
            "total_attendance_records": total_records,
            "present_count": present_count,
            "late_count": late_count,
            "overall_attendance_rate": overall_attendance_rate
        },
        "session_breakdown": session_breakdown,
        "location_breakdown": location_breakdown,
        "student_reports": student_reports,
        "daily_trends": daily_trends
    }
