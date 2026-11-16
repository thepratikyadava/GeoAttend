import json
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


STORE_PATH = Path(__file__).resolve().parent.parent / "geoattend_data.json"

DEFAULT_INSTITUTION_ID = "11111111-2222-3333-4444-555555555555"
DEFAULT_ADMIN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001"
DEFAULT_STUDENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002"
DEFAULT_LOCATION_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffff0001"
DEFAULT_SESSION_ID = "cccccccc-dddd-eeee-ffff-000000000001"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_state() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start_iso = (now - timedelta(minutes=10)).isoformat()
    end_iso = (now + timedelta(hours=2)).isoformat()
    created_iso = (now - timedelta(days=2)).isoformat()

    return {
        "institutions": {
            DEFAULT_INSTITUTION_ID: {
                "id": DEFAULT_INSTITUTION_ID,
                "name": "IIIT Vadodara - International Campus Diu",
                "code": "IIITVDIU",
                "created_by": DEFAULT_ADMIN_ID,
                "is_active": True,
                "created_at": created_iso
            }
        },
        "profiles": {
            DEFAULT_ADMIN_ID: {
                "id": DEFAULT_ADMIN_ID,
                "email": "admin@iiitvadodara.ac.in",
                "full_name": "Pratik Kumar (Admin)",
                "role": "admin",
                "institution_id": DEFAULT_INSTITUTION_ID,
                "created_at": created_iso,
                "updated_at": created_iso
            },
            DEFAULT_STUDENT_ID: {
                "id": DEFAULT_STUDENT_ID,
                "email": "student@iiitvadodara.ac.in",
                "full_name": "Pratik Kumar (Student)",
                "role": "student",
                "institution_id": DEFAULT_INSTITUTION_ID,
                "created_at": created_iso,
                "updated_at": created_iso
            }
        },
        "locations": [
            {
                "id": DEFAULT_LOCATION_ID,
                "institution_id": DEFAULT_INSTITUTION_ID,
                "name": "Academic Block - Education Hub Kevdi",
                "description": "Main lecture halls and computer labs at IIITV-ICD",
                "geofence_type": "circle",
                "center_latitude": 20.7197,
                "center_longitude": 70.9398,
                "radius_meters": 250.0,
                "boundary_geojson": None,
                "is_active": True,
                "created_by": DEFAULT_ADMIN_ID,
                "created_at": created_iso,
                "updated_at": created_iso
            }
        ],
        "sessions": [
            {
                "id": DEFAULT_SESSION_ID,
                "location_id": DEFAULT_LOCATION_ID,
                "name": "EC161 GeoAttend Project Demo Session",
                "start_time": start_iso,
                "end_time": end_iso,
                "is_active": True,
                "created_by": DEFAULT_ADMIN_ID,
                "created_at": created_iso
            }
        ],
        "attendance": []
    }


def load_store() -> dict[str, Any]:
    if not STORE_PATH.exists():
        state = _default_state()
        save_store(state)
        return state
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Ensure active demo session window hasn't expired
        for s in data.get("sessions", []):
            if s.get("id") == DEFAULT_SESSION_ID:
                end_dt = datetime.fromisoformat(
                    str(s["end_time"]).replace("Z", "+00:00")
                )
                if end_dt < datetime.now(timezone.utc):
                    s["start_time"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
                    s["end_time"] = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        return data
    except Exception:
        state = _default_state()
        save_store(state)
        return state


def save_store(data: dict[str, Any]) -> None:
    with open(STORE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_or_sync_profile(
    user_id: str,
    email: str,
    base_profile: dict[str, Any] | None = None,
    user_meta: dict[str, Any] | None = None
) -> dict[str, Any]:
    store = load_store()
    profiles = store.setdefault("profiles", {})
    institutions = store.setdefault("institutions", {})

    existing_override = profiles.get(user_id, {})
    meta = user_meta or {}

    requested_role = (
        existing_override.get("role")
        or meta.get("requested_role")
        or meta.get("role")
        or (base_profile or {}).get("role")
        or "student"
    )
    if requested_role not in ("admin", "student"):
        requested_role = "student"

    full_name = (
        existing_override.get("full_name")
        or (base_profile or {}).get("full_name")
        or meta.get("full_name")
        or email.split("@")[0]
    )

    inst_id = (
        existing_override.get("institution_id")
        or (base_profile or {}).get("institution_id")
    )

    # Check if user requested creating or joining an institution via metadata
    req_code = str(
        meta.get("requested_institution_code")
        or meta.get("institution_code")
        or ""
    ).strip().upper()
    req_name = str(
        meta.get("requested_institution_name")
        or meta.get("institution_name")
        or ""
    ).strip()

    if not inst_id and req_code:
        # Find by code
        matched_inst = next(
            (inst for inst in institutions.values() if inst.get("code") == req_code),
            None
        )
        if matched_inst:
            inst_id = matched_inst["id"]
        elif req_name:
            new_id = str(uuid.uuid4())
            institutions[new_id] = {
                "id": new_id,
                "name": req_name,
                "code": req_code,
                "created_by": user_id,
                "is_active": True,
                "created_at": _now_iso()
            }
            inst_id = new_id

    if not inst_id:
        inst_id = DEFAULT_INSTITUTION_ID

    merged = {
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "role": requested_role,
        "institution_id": inst_id,
        "created_at": (
            (base_profile or {}).get("created_at")
            or existing_override.get("created_at")
            or _now_iso()
        ),
        "updated_at": _now_iso()
    }

    profiles[user_id] = merged
    save_store(store)
    return merged
