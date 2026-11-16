import { useState } from "react";
import {
  MapPin,
  Plus,
  Trash2,
  Navigation,
  CheckCircle2,
  XCircle,
  LocateFixed,
  Power,
  RotateCcw
} from "lucide-react";

import { apiFetch } from "../lib/api";
import GeofenceMap from "./GeofenceMap";


export default function AdminLocationsPanel({
  token,
  locations,
  onRefresh
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [geofenceType, setGeofenceType] = useState("circle");
  const [centerLat, setCenterLat] = useState("20.719700");
  const [centerLng, setCenterLng] = useState("70.939800");
  const [radiusMeters, setRadiusMeters] = useState("120");
  const [polygonPoints, setPolygonPoints] = useState([]);

  const [selectedLocation, setSelectedLocation] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");


  function captureCurrentGps(applyToForm = true) {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setGpsLoading(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Number((pos.coords.accuracy || 0).toFixed(1));

        setUserPosition({
          latitude: lat,
          longitude: lng,
          accuracy: acc
        });

        if (applyToForm && geofenceType === "circle") {
          setCenterLat(String(lat));
          setCenterLng(String(lng));
        }
        setGpsLoading(false);
      },
      (err) => {
        setError(`GPS error: ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }


  function handleMapClick({ lat, lng }) {
    if (geofenceType === "circle") {
      setCenterLat(String(lat));
      setCenterLng(String(lng));
    } else {
      setPolygonPoints((prev) => [...prev, { lat, lng }]);
    }
  }


  async function handleCreateLocation(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      let payload;

      if (geofenceType === "circle") {
        payload = {
          name: name.trim(),
          description: description.trim() || null,
          geofence_type: "circle",
          center_latitude: Number(centerLat),
          center_longitude: Number(centerLng),
          radius_meters: Number(radiusMeters),
          is_active: true
        };
      } else {
        if (polygonPoints.length < 3) {
          throw new Error("Click at least 3 points on the map to define a polygon geofence.");
        }
        const ring = polygonPoints.map((p) => [Number(p.lng), Number(p.lat)]);
        ring.push([Number(polygonPoints[0].lng), Number(polygonPoints[0].lat)]);

        payload = {
          name: name.trim(),
          description: description.trim() || null,
          geofence_type: "polygon",
          boundary_geojson: {
            type: "Polygon",
            coordinates: [ring]
          },
          is_active: true
        };
      }

      await apiFetch("/api/locations", token, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setName("");
      setDescription("");
      setPolygonPoints([]);
      setSuccess("Geofenced location created successfully.");
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }


  async function handleToggleActive(loc) {
    setError("");
    try {
      await apiFetch(`/api/locations/${loc.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !loc.is_active })
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }


  async function handleDeleteLocation(locId) {
    setError("");
    try {
      await apiFetch(`/api/locations/${locId}`, token, {
        method: "DELETE"
      });
      if (selectedLocation?.id === locId) {
        setSelectedLocation(null);
      }
      onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }


  async function handleTestGeofence(loc) {
    setError("");
    setVerifyResult(null);

    const testLat = userPosition?.latitude ?? Number(centerLat);
    const testLng = userPosition?.longitude ?? Number(centerLng);

    if (Number.isNaN(testLat) || Number.isNaN(testLng)) {
      setError("Capture GPS or enter valid coordinates to test geofence.");
      return;
    }

    try {
      const res = await apiFetch(`/api/locations/${loc.id}/verify`, token, {
        method: "POST",
        body: JSON.stringify({
          latitude: testLat,
          longitude: testLng
        })
      });
      setVerifyResult(res);
      setSelectedLocation(loc);
    } catch (err) {
      setError(err.message);
    }
  }


  const draftCircle =
    geofenceType === "circle" &&
    centerLat !== "" &&
    centerLng !== "" &&
    !Number.isNaN(Number(centerLat)) &&
    !Number.isNaN(Number(centerLng))
      ? {
          lat: Number(centerLat),
          lng: Number(centerLng),
          radius: Number(radiusMeters) || 100
        }
      : null;


  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Create Geofence Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Add Geofence Location
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Click on the map or use your device GPS to configure boundaries.
              </p>
            </div>
            <button
              type="button"
              onClick={() => captureCurrentGps(true)}
              disabled={gpsLoading}
              className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <LocateFixed size={14} />
              {gpsLoading ? "Locating..." : "Use My GPS"}
            </button>
          </div>

          <form onSubmit={handleCreateLocation} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                Location Name
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lecture Hall Complex - Block A"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                Description (Optional)
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Ground floor auditorium & labs"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                Geofence Type
              </label>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setGeofenceType("circle")}
                  className={`rounded-lg py-2 text-xs font-semibold transition ${
                    geofenceType === "circle"
                      ? "bg-white text-blue-600 shadow-xs"
                      : "text-slate-600"
                  }`}
                >
                  Circle (Radius)
                </button>
                <button
                  type="button"
                  onClick={() => setGeofenceType("polygon")}
                  className={`rounded-lg py-2 text-xs font-semibold transition ${
                    geofenceType === "polygon"
                      ? "bg-white text-blue-600 shadow-xs"
                      : "text-slate-600"
                  }`}
                >
                  Polygon (Boundary)
                </button>
              </div>
            </div>

            {geofenceType === "circle" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Center Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={centerLat}
                      onChange={(e) => setCenterLat(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Center Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={centerLng}
                      onChange={(e) => setCenterLng(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Allowed Radius (meters)</span>
                    <span className="font-semibold text-blue-600">
                      {radiusMeters} m
                    </span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="1000"
                    step="10"
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(e.target.value)}
                    className="w-full accent-blue-600"
                  />
                  <input
                    type="number"
                    min="5"
                    max="50000"
                    required
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">
                    Polygon Vertices ({polygonPoints.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setPolygonPoints([])}
                    className="flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <RotateCcw size={12} />
                    Reset points
                  </button>
                </div>
                <p className="mt-1 text-slate-500">
                  Click on the map to add at least 3 boundary points around the campus building.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus size={16} />
              {submitting ? "Saving Location..." : "Save Geofence Location"}
            </button>
          </form>
        </div>

        {/* Interactive Map Preview */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Interactive Geofence Map
              </h3>
              <p className="text-xs text-slate-500">
                {geofenceType === "circle"
                  ? "Click anywhere on the map to reposition the geofence center."
                  : "Click multiple points on the map to draw a polygon boundary."}
              </p>
            </div>
            {userPosition && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                GPS: {userPosition.latitude.toFixed(4)}, {userPosition.longitude.toFixed(4)} (±{Math.round(userPosition.accuracy)}m)
              </span>
            )}
          </div>

          <GeofenceMap
            locations={locations}
            selectedLocation={selectedLocation}
            draftCircle={draftCircle}
            draftPolygonPoints={polygonPoints}
            userPosition={userPosition}
            onMapClick={handleMapClick}
            height="400px"
          />

          {verifyResult && (
            <div
              className={`flex items-center justify-between rounded-xl border p-4 text-sm ${
                verifyResult.verification.inside
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <div className="flex items-center gap-3">
                {verifyResult.verification.inside ? (
                  <CheckCircle2 className="text-emerald-600" size={20} />
                ) : (
                  <XCircle className="text-amber-600" size={20} />
                )}
                <div>
                  <p className="font-semibold">
                    Geofence Test: {verifyResult.location.name} —{" "}
                    {verifyResult.verification.inside ? "INSIDE BOUNDARY" : "OUTSIDE BOUNDARY"}
                  </p>
                  <p className="text-xs opacity-85">
                    Measured distance: {verifyResult.verification.distance_meters}m
                    {verifyResult.verification.radius_meters
                      ? ` (Allowed radius: ${verifyResult.verification.radius_meters}m)`
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Configured Locations List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-5">
          <h3 className="text-lg font-semibold text-slate-900">
            Configured Attendance Locations ({locations.length})
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Manage active geofences for your institution.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-4">Location Name</th>
                <th className="p-4">Geofence Type</th>
                <th className="p-4">Coordinates / Boundary</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr
                  key={loc.id}
                  onClick={() => setSelectedLocation(loc)}
                  className={`cursor-pointer border-t border-slate-100 transition hover:bg-slate-50 ${
                    selectedLocation?.id === loc.id ? "bg-blue-50/40" : ""
                  }`}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-2.5">
                      <MapPin size={16} className="text-blue-600" />
                      <div>
                        <p className="font-semibold text-slate-900">{loc.name}</p>
                        {loc.description && (
                          <p className="text-xs text-slate-500">{loc.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 capitalize">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {loc.geofence_type}
                    </span>
                  </td>
                  <td className="p-4 text-xs text-slate-600">
                    {loc.geofence_type === "circle" ? (
                      <span>
                        {Number(loc.center_latitude).toFixed(5)},{" "}
                        {Number(loc.center_longitude).toFixed(5)} ·{" "}
                        <strong className="text-blue-700">{loc.radius_meters}m radius</strong>
                      </span>
                    ) : (
                      <span>
                        Polygon ({(loc.boundary_geojson?.coordinates?.[0]?.length || 1) - 1} vertices)
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        loc.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {loc.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td
                    className="p-4 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestGeofence(loc)}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Test GPS
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(loc)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        title={loc.is_active ? "Deactivate" : "Activate"}
                      >
                        <Power size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLocation(loc.id)}
                        className="rounded-lg border border-red-100 p-1.5 text-red-600 hover:bg-red-50"
                        title="Delete Location"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {locations.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-slate-400">
                    No geofenced locations created yet. Use the form above to add your first location.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
