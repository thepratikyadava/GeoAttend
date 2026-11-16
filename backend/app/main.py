from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes.health import router as health_router
from app.routes.users import router as users_router
from app.routes.locations import router as locations_router
from app.routes.sessions import router as sessions_router
from app.routes.attendance import router as attendance_router
from app.routes.analytics import router as analytics_router


@asynccontextmanager
async def lifespan(app: FastAPI):


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
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


app.include_router(health_router)
app.include_router(users_router)
app.include_router(locations_router)
app.include_router(sessions_router)
app.include_router(attendance_router)
app.include_router(analytics_router)


@app.get("/")
def root():

    return {
        "message": "Welcome to GeoAttend API",
        "docs": "/docs",
        "health": "/api/health"
    }