from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.supabase_client import initialize_supabase
from app.routes.health import router as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):

    initialize_supabase()

    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="GPS-Based Geo-Tagged and Geofenced Attendance Management System",
    version=settings.APP_VERSION,
    lifespan=lifespan
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


app.include_router(health_router)


@app.get("/")
def root():

    return {
        "message": "Welcome to GeoAttend API",
        "docs": "/docs",
        "health": "/api/health"
    }