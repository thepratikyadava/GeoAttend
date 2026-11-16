from fastapi import APIRouter, HTTPException

from app.config import settings

from app.supabase_client import create_public_client


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

    client = None

    try:

        client = create_public_client()

        response = client.rpc(
            "geoattend_health_check"
        ).execute()

        return {
            "status": "connected",
            "database_response": response.data
        }

    except Exception:

        raise HTTPException(
            status_code=503,
            detail="Supabase connection failed"
        )

    finally:

        if client is not None:
            client.postgrest.session.close()