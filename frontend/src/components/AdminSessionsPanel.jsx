import { useState, useEffect } from "react";
import {
  CalendarCheck,
  Clock,
  Plus,
  Trash2,
  Power,
  Users,
  MapPin,
  Sparkles
} from "lucide-react";

import { apiFetch } from "../lib/api";


function toLocalDatetimeInputValue(dateObj) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}` +
    `T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`
  );
}


export default function AdminSessionsPanel({
  token,
  locations,
  sessions,
  onRefresh
}) {
  const activeLocations = locations.filter((l) => l.is_active);

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(activeLocations[0]?.id || "");
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    return toLocalDatetimeInputValue(now);
  });
  const [endTime, setEndTime] = useState(() => {
    const later = new Date(Date.now() + 60 * 60 * 1000);
    return toLocalDatetimeInputValue(later);
  });

  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");


  useEffect(() => {
    if (!locationId && activeLocations.length > 0) {
      setLocationId(activeLocations[0].id);
    }
  }, [activeLocations, locationId]);


  useEffect(() => {
    if (!token) return;
    let active = true;

    async function loadAttendance() {
      setLoadingRecords(true);
      try {
        const query = selectedSessionId
          ? `/api/attendance/all?session_id=${encodeURIComponent(selectedSessionId)}`
          : "/api/attendance/all";
        const res = await apiFetch(query, token);
        if (active) {
          setAttendanceRecords(res.records || []);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoadingRecords(false);
      }
    }

    loadAttendance();
    return () => {
      active = false;
    };
  }, [token, selectedSessionId, sessions]);


  function setQuickLiveWindow(minutes = 60) {
    const start = new Date(Date.now() - 2 * 60 * 1000);
    const end = new Date(Date.now() + minutes * 60 * 1000);
    setStartTime(toLocalDatetimeInputValue(start));
    setEndTime(toLocalDatetimeInputValue(end));
  }


  async function handleCreateSession(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!locationId) {
      setError("Please select an active geofence location first.");
      return;
    }

    setSubmitting(true);
    try {
      const startIso = new Date(startTime).toISOString();
      const endIso = new Date(endTime).toISOString();

      await apiFetch("/api/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          location_id: locationId,
          start_time: startIso,
          end_time: endIso,
          is_active: true
        })
      });

      setName("");
      setSuccess("Attendance session scheduled and opened.");
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }


  async function handleToggleSession(sessionRow) {
    setError("");
    try {
      await apiFetch(`/api/sessions/${sessionRow.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !sessionRow.is_active })
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }


  async function handleDeleteSession(sessionId) {
    setError("");
    try {
      await apiFetch(`/api/sessions/${sessionId}`, token, {
        method: "DELETE"
      });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId("");
      }
      onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }


  function badgeStyle(timingStatus) {
    if (timingStatus === "ongoing") {
      return "bg-emerald-50 text-emerald-700";
    }
    if (timingStatus === "upcoming") {
      return "bg-blue-50 text-blue-700";
    }
    return "bg-slate-100 text-slate-600";
  }


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
        {/* Create Session Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Create Attendance Session
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Bind a time window to a geofenced campus location.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQuickLiveWindow(60)}
              className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <Sparkles size={13} />
              Live Now (1h)
            </button>
          </div>

          <form onSubmit={handleCreateSession} className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                Session Name
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. EC161 Morning Lecture - Week 8"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                Geofence Location
              </label>
              <select
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Select a location...</option>
                {activeLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.geofence_type === "circle" ? `${loc.radius_meters}m` : "Polygon"})
                  </option>
                ))}
              </select>
              {activeLocations.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  Create an active geofence location in the Locations tab first.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || activeLocations.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus size={16} />
              {submitting ? "Creating Session..." : "Create Attendance Session"}
            </button>
          </form>
        </div>

        {/* Sessions Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white lg:col-span-7">
          <div className="border-b border-slate-200 p-5">
            <h3 className="text-lg font-semibold text-slate-900">
              Scheduled Sessions ({sessions.length})
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Click any session to filter the verified student check-ins below.
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="p-3.5">Session</th>
                  <th className="p-3.5">Window</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Checked In</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() =>
                      setSelectedSessionId((prev) => (prev === s.id ? "" : s.id))
                    }
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                      selectedSessionId === s.id ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <td className="p-3.5">
                      <p className="font-semibold text-slate-900">{s.name}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <MapPin size={12} />
                        {s.location?.name || "Unknown location"}
                      </p>
                    </td>
                    <td className="p-3.5 text-xs text-slate-600">
                      <div>{new Date(s.start_time).toLocaleString()}</div>
                      <div className="text-slate-400">
                        to {new Date(s.end_time).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${badgeStyle(
                          s.timing_status
                        )}`}
                      >
                        {s.timing_status}
                      </span>
                    </td>
                    <td className="p-3.5 font-semibold text-slate-800">
                      {s.attendance_count || 0}
                    </td>
                    <td
                      className="p-3.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleSession(s)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                          title={s.is_active ? "Close Session" : "Reopen Session"}
                        >
                          <Power size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSession(s.id)}
                          className="rounded-lg border border-red-100 p-1.5 text-red-600 hover:bg-red-50"
                          title="Delete Session"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {sessions.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-400">
                      No attendance sessions scheduled yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Verified Attendance Log */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Verified GPS Attendance Records ({attendanceRecords.length})
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Real-time geo-verified student check-ins across your institution.
            </p>
          </div>

          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium outline-none focus:border-blue-500"
          >
            <option value="">All Sessions</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {loadingRecords ? (
          <p className="p-6 text-sm text-slate-500">Loading attendance log...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="p-4">Student</th>
                  <th className="p-4">Session & Location</th>
                  <th className="p-4">Distance & Accuracy</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Verified At</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRecords.map((rec) => (
                  <tr key={rec.id} className="border-t border-slate-100">
                    <td className="p-4 font-medium text-slate-900">
                      {rec.student_name}
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-slate-800">{rec.session_name}</p>
                      <p className="text-xs text-slate-500">{rec.location_name}</p>
                    </td>
                    <td className="p-4 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {rec.distance_meters}m
                      </span>{" "}
                      from center
                      {rec.gps_accuracy_meters != null && (
                        <span className="text-slate-400">
                          {" "}
                          (±{Math.round(rec.gps_accuracy_meters)}m GPS)
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${
                          rec.status === "present"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {rec.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-slate-500">
                      {new Date(rec.verified_at).toLocaleString()}
                    </td>
                  </tr>
                ))}

                {attendanceRecords.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-slate-400">
                      No attendance records found for the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
