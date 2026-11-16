import { useState, useEffect } from "react";
import {
  MapPin,
  LocateFixed,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertCircle,
  Download
} from "lucide-react";

import { apiFetch } from "../lib/api";
import GeofenceMap from "./GeofenceMap";


export default function StudentAttendancePanel({
  token,
  locations,
  sessions,
  onRefresh
}) {
  const [myAttendance, setMyAttendance] = useState({
    summary: {
      total_sessions: 0,
      attended: 0,
      present: 0,
      late: 0,
      missed: 0,
      attendance_rate: 0
    },
    records: []
  });

  const [userPosition, setUserPosition] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [distancePreview, setDistancePreview] = useState(null);

  const [markingId, setMarkingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");


  async function loadMyHistory() {
    if (!token) return;
    try {
      const res = await apiFetch("/api/attendance/me", token);
      setMyAttendance(res);
    } catch (err) {
      setError(err.message);
    }
  }


  useEffect(() => {
    loadMyHistory();
  }, [token, sessions]);


  useEffect(() => {
    if (!selectedSession && sessions.length > 0) {
      const ongoing = sessions.find((s) => s.timing_status === "ongoing");
      setSelectedSession(ongoing || sessions[0]);
    }
  }, [sessions, selectedSession]);


  function captureStudentGps(callback) {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setGpsLoading(true);
    setError("");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Number((pos.coords.accuracy || 0).toFixed(1))
        };
        setUserPosition(coords);
        setGpsLoading(false);
        if (callback) callback(coords);
      },
      (err) => {
        setError(
          `Unable to acquire GPS coordinates (${err.message}). Please allow location permissions in your browser.`
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }


  async function handleCheckDistance(sessionRow) {
    setSelectedSession(sessionRow);
    setDistancePreview(null);
    setError("");

    const runCheck = async (coords) => {
      try {
        const res = await apiFetch(
          `/api/locations/${sessionRow.location_id}/verify`,
          token,
          {
            method: "POST",
            body: JSON.stringify({
              latitude: coords.latitude,
              longitude: coords.longitude
            })
          }
        );
        setDistancePreview(res.verification);
      } catch (err) {
        setError(err.message);
      }
    };

    if (userPosition) {
      await runCheck(userPosition);
    } else {
      captureStudentGps(runCheck);
    }
  }


  async function handleMarkAttendance(sessionRow) {
    setError("");
    setSuccess("");
    setSelectedSession(sessionRow);

    const submitAttendance = async (coords) => {
      setMarkingId(sessionRow.id);
      try {
        const res = await apiFetch("/api/attendance/mark", token, {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionRow.id,
            latitude: coords.latitude,
            longitude: coords.longitude,
            gps_accuracy_meters: coords.accuracy
          })
        });

        setSuccess(
          `${res.message} — Distance: ${res.verification.distance_meters}m`
        );
        await loadMyHistory();
        onRefresh();
      } catch (err) {
        setError(err.message);
      } finally {
        setMarkingId(null);
      }
    };

    captureStudentGps(submitAttendance);
  }


  function exportMyHistoryCsv() {
    if (!myAttendance.records.length) return;
    const headers = [
      "Session",
      "Location",
      "Status",
      "Distance (m)",
      "GPS Accuracy (m)",
      "Latitude",
      "Longitude",
      "Verified At"
    ];
    const rows = myAttendance.records.map((r) => [
      `"${(r.session?.name || "").replace(/"/g, '""')}"`,
      `"${(r.location?.name || "").replace(/"/g, '""')}"`,
      r.status,
      r.distance_meters,
      r.gps_accuracy_meters ?? "",
      r.latitude,
      r.longitude,
      r.verified_at
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my_geoattend_history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }


  const { summary, records } = myAttendance;


  return (
    <div className="space-y-6">
      {/* Student KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            My Attendance Rate
          </p>
          <p className="mt-3 text-3xl font-bold text-blue-600">
            {summary.attendance_rate}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.attended} of {summary.total_sessions} sessions attended
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            On-Time (Present)
          </p>
          <p className="mt-3 text-3xl font-bold text-emerald-600">
            {summary.present}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Verified within grace window
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Late Check-Ins
          </p>
          <p className="mt-3 text-3xl font-bold text-amber-600">
            {summary.late}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Verified after grace window
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Missed Sessions
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-700">
            {summary.missed}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Unmarked sessions
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-600">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
          <CheckCircle2 size={18} />
          <span>{success}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Active Sessions & Check-In */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Attendance Sessions
              </h3>
              <p className="text-xs text-slate-500">
                Select an active session to verify your GPS position and mark attendance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => captureStudentGps()}
              disabled={gpsLoading}
              className="flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <LocateFixed size={14} />
              {gpsLoading ? "Locating..." : "Refresh GPS"}
            </button>
          </div>

          <div className="space-y-3">
            {sessions.map((s) => {
              const alreadyMarked = !!s.my_attendance;
              const isOngoing = s.timing_status === "ongoing";

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSession(s)}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    selectedSession?.id === s.id
                      ? "border-blue-500 bg-blue-50/30"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-900">{s.name}</h4>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                            isOngoing
                              ? "bg-emerald-100 text-emerald-800"
                              : s.timing_status === "upcoming"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {s.timing_status}
                        </span>
                      </div>

                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                        <MapPin size={13} className="text-blue-600" />
                        {s.location?.name || "Campus Location"}
                        {s.location?.geofence_type === "circle" &&
                          ` (${s.location.radius_meters}m radius)`}
                      </p>

                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <Clock size={12} />
                        {new Date(s.start_time).toLocaleString()} –{" "}
                        {new Date(s.end_time).toLocaleTimeString()}
                      </p>
                    </div>

                    {alreadyMarked ? (
                      <span className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-bold uppercase text-emerald-700">
                        <CheckCircle2 size={14} />
                        {s.my_attendance.status}
                      </span>
                    ) : isOngoing ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <button
                          type="button"
                          disabled={markingId === s.id || gpsLoading}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkAttendance(s);
                          }}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {markingId === s.id
                            ? "Verifying GPS..."
                            : "Mark Attendance"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCheckDistance(s);
                          }}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Check distance
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {s.timing_status === "upcoming"
                          ? "Not started"
                          : "Session ended"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {sessions.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">
                No attendance sessions have been scheduled by your institution yet.
              </p>
            )}
          </div>
        </div>

        {/* Live Map & Geofence Status */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Live Geofence Map
              </h3>
              <p className="text-xs text-slate-500">
                Blue marker shows your live GPS position relative to the session boundary.
              </p>
            </div>

            {userPosition && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Accuracy: ±{Math.round(userPosition.accuracy)}m
              </span>
            )}
          </div>

          <GeofenceMap
            locations={locations}
            selectedLocation={selectedSession?.location || null}
            userPosition={userPosition}
            height="360px"
          />

          {distancePreview && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                distancePreview.inside
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <p className="font-semibold">
                {distancePreview.inside
                  ? "You are INSIDE the geofence boundary."
                  : "You are OUTSIDE the geofence boundary."}
              </p>
              <p className="mt-0.5">
                Current distance: <strong>{distancePreview.distance_meters}m</strong>
                {distancePreview.radius_meters
                  ? ` (Allowed radius: ${distancePreview.radius_meters}m)`
                  : ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Student Attendance History Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              My Verified Attendance History ({records.length})
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Complete log of your geo-tagged attendance records.
            </p>
          </div>

          <button
            type="button"
            onClick={exportMyHistoryCsv}
            disabled={records.length === 0}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="p-4">Session</th>
                <th className="p-4">Location</th>
                <th className="p-4">Distance</th>
                <th className="p-4">GPS Coordinates</th>
                <th className="p-4">Status</th>
                <th className="p-4">Verified At</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-4 font-semibold text-slate-900">
                    {r.session?.name || "Session"}
                  </td>
                  <td className="p-4 text-slate-600">
                    {r.location?.name || "Location"}
                  </td>
                  <td className="p-4 text-xs font-medium text-slate-700">
                    {r.distance_meters}m
                    {r.gps_accuracy_meters != null && (
                      <span className="text-slate-400">
                        {" "}
                        (±{Math.round(r.gps_accuracy_meters)}m)
                      </span>
                    )}
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500">
                    {Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)}
                  </td>
                  <td className="p-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${
                        r.status === "present"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="p-4 text-xs text-slate-500">
                    {new Date(r.verified_at).toLocaleString()}
                  </td>
                </tr>
              ))}

              {records.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">
                    You have not marked attendance for any session yet.
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
