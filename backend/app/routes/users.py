import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)
from app.local_store import (
    DEFAULT_INSTITUTION_ID,
    load_store,
    save_store
)


router = APIRouter(
    prefix="/api",
    tags=["Authentication and Users"]
)


INSTITUTION_CODE_PATTERN = re.compile(r"^[A-Z0-9_-]{3,20}$")


class ProfileUpdate(BaseModel):

    full_name: str


class RoleSwitchPayload(BaseModel):

    role: Literal["admin", "student"]


class JoinInstitutionPayload(BaseModel):

    institution_code: str


class CreateInstitutionPayload(BaseModel):

    name: str
    code: str


def _resolve_institution(context: AuthContext, inst_id: str | None) -> dict | None:
    if not inst_id:
        return None

    store = load_store()
    local_inst = store.get("institutions", {}).get(inst_id)
    if local_inst:
        return local_inst

    if context.db is not None:
        try:
            res = (
                context.db.table("institutions")
                .select("id, name, code, is_active, created_at")
                .eq("id", inst_id)
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0]
        except Exception:
            pass

    return store.get("institutions", {}).get(DEFAULT_INSTITUTION_ID)


@router.get("/me")
def get_my_profile(
    context: AuthContext = Depends(get_current_context)
):
    inst_id = context.profile.get("institution_id")
    institution = _resolve_institution(context, inst_id)

    return {
        "user": {
            "id": str(context.user.id),
            "email": context.user.email
        },
        "profile": context.profile,
        "institution": institution
    }


@router.patch("/me")
def update_my_profile(
    payload: ProfileUpdate,
    context: AuthContext = Depends(get_current_context)
):
    name = payload.full_name.strip()

    if not name or len(name) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must contain between 1 and 100 characters"
        )

    uid = str(context.user.id)
    store = load_store()
    if uid in store.get("profiles", {}):
        store["profiles"][uid]["full_name"] = name
        store["profiles"][uid]["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_store(store)

    if context.db is not None:
        try:
            context.db.table("profiles").update({"full_name": name}).eq("id", uid).execute()
        except Exception:
            pass

    updated = {**context.profile, "full_name": name}
    return {
        "message": "Profile updated",
        "profile": updated
    }


@router.post("/me/role")
def switch_my_role(
    payload: RoleSwitchPayload,
    context: AuthContext = Depends(get_current_context)
):
    uid = str(context.user.id)
    store = load_store()
    profiles = store.setdefault("profiles", {})

    updated = {
        **context.profile,
        "role": payload.role,
        "institution_id": context.profile.get("institution_id") or DEFAULT_INSTITUTION_ID,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    profiles[uid] = updated
    save_store(store)

    return {
        "message": f"Switched active role to {payload.role}",
        "profile": updated
    }


@router.post("/institutions/join")
def join_institution(
    payload: JoinInstitutionPayload,
    context: AuthContext = Depends(get_current_context)
):
    code = payload.institution_code.strip().upper()
    if not INSTITUTION_CODE_PATTERN.match(code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Institution code must be 3-20 uppercase letters, numbers, hyphens, or underscores"
        )

    store = load_store()
    institutions = store.setdefault("institutions", {})
    matched = next(
        (inst for inst in institutions.values() if inst.get("code") == code),
        None
    )

    if not matched:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid or inactive institution code (Try IIITVDIU)"
        )

    uid = str(context.user.id)
    updated_profile = {
        **context.profile,
        "institution_id": matched["id"],
        "role": "student",
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    store.setdefault("profiles", {})[uid] = updated_profile
    save_store(store)

    return {
        "message": "Joined institution successfully",
        "profile": updated_profile,
        "institution": matched
    }


@router.post("/institutions/create")
def create_institution(
    payload: CreateInstitutionPayload,
    context: AuthContext = Depends(get_current_context)
):
    name = payload.name.strip()
    code = payload.code.strip().upper()

    if not name or len(name) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Institution name must be between 1 and 120 characters"
        )

    if not INSTITUTION_CODE_PATTERN.match(code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Institution code must be 3-20 uppercase letters, numbers, hyphens, or underscores"
        )

    store = load_store()
    institutions = store.setdefault("institutions", {})
    existing = next(
        (inst for inst in institutions.values() if inst.get("code") == code),
        None
    )

    uid = str(context.user.id)
    now_iso = datetime.now(timezone.utc).isoformat()

    if existing:
        inst_obj = existing
    else:
        new_id = str(uuid.uuid4())
        inst_obj = {
            "id": new_id,
            "name": name,
            "code": code,
            "created_by": uid,
            "is_active": True,
            "created_at": now_iso
        }
        institutions[new_id] = inst_obj

    updated_profile = {
        **context.profile,
        "institution_id": inst_obj["id"],
        "role": "admin",
        "updated_at": now_iso
    }
    store.setdefault("profiles", {})[uid] = updated_profile
    save_store(store)

    return {
        "message": "Institution configured and administrator role assigned",
        "data": {
            "institution": inst_obj,
            "profile": updated_profile
        }
    }


@router.get("/admin/users")
def get_institution_users(
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    store = load_store()

    users_by_id: dict[str, dict] = {}
    for uid, prof in store.get("profiles", {}).items():
        if prof.get("institution_id") == inst_id:
            users_by_id[uid] = prof

    if context.db is not None:
        try:
            result = (
                context.db.table("profiles")
                .select("id, full_name, role, institution_id, created_at, updated_at")
                .eq("institution_id", inst_id)
                .order("created_at", desc=True)
                .execute()
            )
            for row in (result.data or []):
                if row["id"] not in users_by_id:
                    users_by_id[row["id"]] = row
        except Exception:
            pass

    users_list = sorted(
        users_by_id.values(),
        key=lambda u: str(u.get("created_at", "")),
        reverse=True
    )

    return {
        "total": len(users_list),
        "users": users_list
    }


@router.get("/admin/institution")
def get_institution(
    context: AuthContext = Depends(require_admin)
):
    inst_id = context.profile["institution_id"]
    inst = _resolve_institution(context, inst_id)
    if not inst:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Institution record not found"
        )
    return inst
