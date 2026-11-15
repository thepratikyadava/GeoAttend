from fastapi import APIRouter, HTTPException

from app.config import settings
from app.supabase_client import get_supabase


router = APIRouter(
    prefix="/api",
    tags=["System"]
)


@router.get("/health")
def health_check():

    return {
        "status": "healthy",
        "application": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.APP_ENV
    }


@router.get("/supabase-health")
def supabase_health():

    try:
        client = get_supabase()

        response = client.rpc(
            "geoattend_health_check"
        ).execute()

        return {
            "status": "connected",
            "database_response": response.data
        }

    except Exception as error:

        raise HTTPException(
            status_code=503,
            detail=f"Supabase connection check failed: {str(error)}"
        )