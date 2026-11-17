import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.supabase_client import create_user_client
from app.services.geofence import (
    haversine_distance_meters,
    verify_location_geofence
)
from app.services.face import (
    validate_face_descriptor,
    verify_face_descriptor
)


client = TestClient(app)


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


def test_invalid_bearer_token_returns_401():
    response = client.get(
        "/api/me",
        headers={"Authorization": "Bearer demo-admin-token"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired authentication session"


def test_create_user_client_sets_authorization_header():
    user_client = create_user_client("sample-jwt-token")
    auth_header = user_client.postgrest.session.headers.get("Authorization")
    assert auth_header == "Bearer sample-jwt-token"


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


def test_face_descriptor_validation_and_matching():
    vec_a = [0.1] * 128
    vec_close = [0.11] * 128
    vec_far = [0.5] * 128

    assert len(validate_face_descriptor(vec_a)) == 128

    with pytest.raises(ValueError):
        validate_face_descriptor([0.1] * 10)

    match_res = verify_face_descriptor(vec_a, vec_close)
    assert match_res["matched"] is True
    assert match_res["distance"] < 0.55

    mismatch_res = verify_face_descriptor(vec_a, vec_far)
    assert mismatch_res["matched"] is False
    assert mismatch_res["distance"] > 0.55
