from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from supabase import Client

from app.supabase_client import create_user_client


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:

    user: Any
    profile: dict
    db: Client
    access_token: str


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

    try:

        client = create_user_client(token)

        # Verify token with Supabase Auth
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

    try:

        # Read profile under the user's own RLS context
        profile_response = (
            client.table("profiles")
            .select(
                "id, full_name, role, institution_id, face_descriptor, face_registered_at, created_at, updated_at"
            )
            .eq("id", str(user.id))
            .limit(1)
            .execute()
        )

        rows = profile_response.data or []
        profile = rows[0] if rows else None

        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User profile not found in database. Ensure database/phase2.sql is installed."
            )

        return AuthContext(
            user=user,
            profile=profile,
            db=client,
            access_token=token
        )

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load user profile: {str(exc)}"
        ) from exc


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
