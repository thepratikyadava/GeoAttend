import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.supabase_client import create_user_client
from app.services.geofence import (
    haversine_distance_meters,
    verify_location_geofence
)


client = TestClient(app)

ADMIN_HEADERS = {"Authorization": "Bearer demo-admin-token"}
STUDENT_HEADERS = {"Authorization": "Bearer demo-student-token"}


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["application"] == "GeoAttend"


def test_unauthenticated_me_returns_401():
    response = client.get("/api/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_create_user_client_sets_authorization_header():
    user_client = create_user_client("sample-jwt-token")
    auth_header = user_client.postgrest.session.headers.get("Authorization")
    assert auth_header == "Bearer sample-jwt-token"


def test_admin_role_full_flow():
    # 1. Verify Admin profile & institution
    me_res = client.get("/api/me", headers=ADMIN_HEADERS)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["profile"]["role"] == "admin"
    assert me_data["institution"]["code"] == "IIITVDIU"

    # 2. Admin lists users & institution
    users_res = client.get("/api/admin/users", headers=ADMIN_HEADERS)
    assert users_res.status_code == 200
    assert users_res.json()["total"] >= 2

    # 3. Admin lists locations & sessions
    loc_res = client.get("/api/locations", headers=ADMIN_HEADERS)
    assert loc_res.status_code == 200
    assert loc_res.json()["total"] >= 1

    sess_res = client.get("/api/sessions", headers=ADMIN_HEADERS)
    assert sess_res.status_code == 200
    assert sess_res.json()["total"] >= 1

    # 4. Admin fetches analytics overview
    analytics_res = client.get("/api/analytics/overview", headers=ADMIN_HEADERS)
    assert analytics_res.status_code == 200
    assert "kpis" in analytics_res.json()


def test_student_role_full_flow():
    # 1. Verify Student profile
    me_res = client.get("/api/me", headers=STUDENT_HEADERS)
    assert me_res.status_code == 200
    assert me_res.json()["profile"]["role"] == "student"

    # 2. Student cannot access admin-only endpoint
    admin_check = client.get("/api/admin/users", headers=STUDENT_HEADERS)
    assert admin_check.status_code == 403

    # 3. Student lists sessions and checks attendance history
    sess_res = client.get("/api/sessions", headers=STUDENT_HEADERS)
    assert sess_res.status_code == 200
    sessions = sess_res.json()["sessions"]
    assert len(sessions) >= 1

    att_res = client.get("/api/attendance/me", headers=STUDENT_HEADERS)
    assert att_res.status_code == 200
    assert "summary" in att_res.json()


def test_circle_geofence_verification():
    location = {
        "geofence_type": "circle",
        "center_latitude": 20.7197,
        "center_longitude": 70.9398,
        "radius_meters": 100.0
    }

    res_inside = verify_location_geofence(20.7197, 70.9398, location)
    assert res_inside["inside"] is True
    assert res_inside["distance_meters"] == 0.0

    res_outside = verify_location_geofence(20.7250, 70.9450, location)
    assert res_outside["inside"] is False
    assert res_outside["distance_meters"] > 100.0


def test_polygon_geofence_verification():
    location = {
        "geofence_type": "polygon",
        "boundary_geojson": {
            "type": "Polygon",
            "coordinates": [[
                [70.9380, 20.7180],
                [70.9410, 20.7180],
                [70.9410, 20.7210],
                [70.9380, 20.7210],
                [70.9380, 20.7180]
            ]]
        }
    }

    res_in = verify_location_geofence(20.7195, 70.9395, location)
    assert res_in["inside"] is True

    res_out = verify_location_geofence(20.7300, 70.9500, location)
    assert res_out["inside"] is False


def test_haversine_distance_sanity():
    dist = haversine_distance_meters(20.7197, 70.9398, 20.7197, 70.9398)
    assert dist == 0.0
