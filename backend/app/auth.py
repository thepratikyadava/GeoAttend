from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from supabase import Client

from app.supabase_client import create_user_client
from app.local_store import (
    DEFAULT_ADMIN_ID,
    DEFAULT_STUDENT_ID,
    get_or_sync_profile,
    load_store
)


bearer_scheme = HTTPBearer(auto_error=False)


DEMO_TOKENS = {
    "demo-admin-token": {
        "id": DEFAULT_ADMIN_ID,
        "email": "admin@iiitvadodara.ac.in",
        "role": "admin",
        "full_name": "Pratik Kumar (Admin)"
    },
    "demo-student-token": {
        "id": DEFAULT_STUDENT_ID,
        "email": "student@iiitvadodara.ac.in",
        "role": "student",
        "full_name": "Pratik Kumar (Student)"
    }
}


@dataclass
class AuthContext:

    user: Any
    profile: dict
    db: Client | None
    access_token: str
    is_demo: bool = False


def get_current_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    )
) -> AuthContext:

    if credentials is None or not credentials.credentials:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )

    token = credentials.credentials

    # 1. Check built-in instant Admin / Student tokens
    if token in DEMO_TOKENS:
        info = DEMO_TOKENS[token]
        store = load_store()
        stored_profile = store.get("profiles", {}).get(info["id"])
        profile = get_or_sync_profile(
            user_id=info["id"],
            email=info["email"],
            base_profile=stored_profile or {
                "id": info["id"],
                "full_name": info["full_name"],
                "role": info["role"]
            },
            user_meta={"role": (stored_profile or {}).get("role", info["role"])}
        )
        user_obj = SimpleNamespace(
            id=info["id"],
            email=info["email"],
            user_metadata={"full_name": profile["full_name"], "role": profile["role"]}
        )
        return AuthContext(
            user=user_obj,
            profile=profile,
            db=None,
            access_token=token,
            is_demo=True
        )

    # 2. Verify real Supabase JWT token
    try:

        client = create_user_client(token)

        response = client.auth.get_user(token)

        user = response.user if response else None

        if user is None:
            raise ValueError("Invalid user")

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication session"
        ) from exc

    # 3. Load profile from Supabase and merge with local role/institution state
    base_profile = None
    try:
        profile_response = (
            client.table("profiles")
            .select(
                "id, full_name, role, institution_id, created_at, updated_at"
            )
            .eq("id", str(user.id))
            .limit(1)
            .execute()
        )
        rows = profile_response.data or []
        base_profile = rows[0] if rows else None
    except Exception:
        base_profile = None

    user_meta = getattr(user, "user_metadata", None) or {}
    profile = get_or_sync_profile(
        user_id=str(user.id),
        email=str(user.email or "user@geoattend.app"),
        base_profile=base_profile,
        user_meta=user_meta
    )

    return AuthContext(
        user=user,
        profile=profile,
        db=client,
        access_token=token,
        is_demo=False
    )


def require_admin(
    context: AuthContext = Depends(get_current_context)
) -> AuthContext:

    if context.profile.get("role") != "admin":

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required"
        )

    if not context.profile.get("institution_id"):

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator is not assigned to an institution"
        )

    return context


def require_student(
    context: AuthContext = Depends(get_current_context)
) -> AuthContext:

    if context.profile.get("role") != "student":

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access required"
        )

    return context
