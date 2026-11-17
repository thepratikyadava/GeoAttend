import re
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import (
    AuthContext,
    get_current_context,
    require_admin
)


router = APIRouter(
    prefix="/api",
    tags=["Authentication and Users"]
)


INSTITUTION_CODE_PATTERN = re.compile(r"^[A-Z0-9_-]{3,20}$")


class ProfileUpdate(BaseModel):

    full_name: str


class JoinInstitutionPayload(BaseModel):

    institution_code: str


class CreateInstitutionPayload(BaseModel):

    name: str
    code: str


@router.get("/me")
def get_my_profile(
    context: AuthContext = Depends(get_current_context)
):
    institution = None
    inst_id = context.profile.get("institution_id")

    if inst_id:
        try:
            inst_res = (
                context.db.table("institutions")
                .select("id, name, code, is_active, created_at")
                .eq("id", inst_id)
                .limit(1)
                .execute()
            )
            if inst_res.data:
                institution = inst_res.data[0]
        except Exception:
            institution = None

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

    result = (
        context.db.table("profiles")
        .update({"full_name": name})
        .eq("id", str(context.user.id))
        .execute()
    )

    updated = result.data[0] if result.data else {
        **context.profile,
        "full_name": name
    }

    return {
        "message": "Profile updated",
        "profile": updated
    }


@router.post("/institutions/join")
def join_institution(
    payload: JoinInstitutionPayload,
    context: AuthContext = Depends(get_current_context)
):
    if context.profile.get("institution_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is already linked to an institution"
        )

    code = payload.institution_code.strip().upper()
    if not INSTITUTION_CODE_PATTERN.match(code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Institution code must be 3-20 uppercase letters, numbers, hyphens, or underscores"
        )

    try:
        rpc_res = context.db.rpc(
            "join_institution_by_code",
            {"target_code": code}
        ).execute()

        return {
            "message": "Joined institution successfully",
            "profile": rpc_res.data
        }
    except Exception as exc:
        msg = str(exc)
        if "Invalid or inactive institution code" in msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invalid or inactive institution code"
            ) from exc
        if "join_institution_by_code" in msg:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database function join_institution_by_code is missing. Please run database/phase2.sql in Supabase SQL Editor."
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to join institution: {msg}"
        ) from exc


@router.post("/institutions/create")
def create_institution(
    payload: CreateInstitutionPayload,
    context: AuthContext = Depends(get_current_context)
):
    if context.profile.get("institution_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your account is already linked to an institution"
        )

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

    try:
        rpc_res = context.db.rpc(
            "create_institution_and_assign_admin",
            {
                "inst_name": name,
                "inst_code": code
            }
        ).execute()

        return {
            "message": "Institution created and administrator role assigned",
            "data": rpc_res.data
        }
    except Exception as exc:
        msg = str(exc)
        if "duplicate key" in msg.lower() or "unique" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An institution with this code already exists"
            ) from exc
        if "create_institution_and_assign_admin" in msg:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database function create_institution_and_assign_admin is missing. Please run database/phase2.sql in Supabase SQL Editor."
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to create institution: {msg}"
        ) from exc


@router.get("/admin/users")
def get_institution_users(
    context: AuthContext = Depends(require_admin)
):

    result = (
        context.db.table("profiles")
        .select(
            "id, full_name, role, institution_id, created_at, updated_at"
        )
        .eq(
            "institution_id",
            context.profile["institution_id"]
        )
        .order("created_at", desc=True)
        .execute()
    )

    rows = result.data or []

    return {
        "total": len(rows),
        "users": rows
    }


@router.get("/admin/institution")
def get_institution(
    context: AuthContext = Depends(require_admin)
):

    result = (
        context.db.table("institutions")
        .select("id, name, code, is_active, created_at")
        .eq("id", context.profile["institution_id"])
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Institution record not found"
        )

    return result.data[0]
