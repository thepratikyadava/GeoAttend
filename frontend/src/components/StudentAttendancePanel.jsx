import { useState, useEffect } from "react";
import {
  MapPin,
  LocateFixed,
  CheckCircle2,
  Clock,
  AlertCircle,
  Download,
  ScanFace,
  UserCircle2,
  Save
} from "lucide-react";

import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import GeofenceMap from "./GeofenceMap";
import FaceCaptureModal, { preloadFaceModels } from "./FaceCaptureModal";


export default function StudentAttendancePanel({
  token,
  profile,
  locations,
  sessions,
  onRefresh,
  onRefreshProfile
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

  const [fullNameInput, setFullNameInput] = useState(profile?.full_name || "");
  const [rollNoInput, setRollNoInput] = useState(profile?.roll_no || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [userPosition, setUserPosition] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [distancePreview, setDistancePreview] = useState(null);

  const [markingId, setMarkingId] = useState(null);
  const [faceRegisterModalOpen, setFaceRegisterModalOpen] = useState(false);
  const [faceVerifyContext, setFaceVerifyContext] = useState(null);
  const [localFaceSaved, setLocalFaceSaved] = useState(() => {
    if (!profile?.id) return false;
    return Boolean(localStorage.getItem(`geoattend_face_${profile.id}`));
  });

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");


  const hasFaceRegistered = Boolean(profile?.has_face_registered || localFaceSaved);


  // Preload face recognition models in background on mount for instant camera verification
  useEffect(() => {
    preloadFaceModels().catch(() => {});
  }, []);


  useEffect(() => {
    setFullNameInput(profile?.full_name || "");
    setRollNoInput(profile?.roll_no || "");
  }, [profile?.full_name, profile?.roll_no]);


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


  async function handleSaveProfile(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSavingProfile(true);
    try {
      await apiFetch("/api/me", token, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: fullNameInput.trim(),
          roll_no: rollNoInput.trim().toUpperCase()
        })
      });
      setSuccess("Profile & Roll No. updated successfully.");
      if (onRefreshProfile) {
        await onRefreshProfile();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingProfile(false);
    }
  }


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


  async function handleSaveFaceRegistration(descriptorOrPoses) {
    setError("");
    setSuccess("");

    // Always keep a local backup keyed by user ID
    if (profile?.id) {
      try {
        localStorage.setItem(
          `geoattend_face_${profile.id}`,
          JSON.stringify(descriptorOrPoses)
        );
        setLocalFaceSaved(true);
      } catch {
        // Ignore storage quota errors
      }
    }

    let savedToBackend = false;

    // 1. Primary: Save via FastAPI Backend (/api/me/face)
    try {
      await apiFetch("/api/me/face", token, {
        method: "POST",
        body: JSON.stringify({ face_descriptor: descriptorOrPoses })
      });
      savedToBackend = true;
    } catch {
      savedToBackend = false;
    }

    // 2. Fallback: Save directly via Supabase (profiles + auth user_metadata)
    if (!savedToBackend && supabase && profile?.id) {
      const nowIso = new Date().toISOString();
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({
          face_descriptor: descriptorOrPoses,
          face_registered_at: nowIso
        })
        .eq("id", profile.id);

      const { error: authErr } = await supabase.auth.updateUser({
        data: {
          face_descriptor: descriptorOrPoses,
          face_registered_at: nowIso
        }
      });

      if (!dbErr || !authErr) {
        savedToBackend = true;
      }
    }

    setFaceRegisterModalOpen(false);
    setSuccess(
      savedToBackend
        ? "Multi-pose Facial Data registered! You can now mark attendance."
        : "Facial Data saved locally on this device. You can now mark attendance."
    );
    if (onRefreshProfile) {
      await onRefreshProfile().catch(() => {});
    }
  }


  async function handleMarkAttendance(sessionRow) {
    setError("");
    setSuccess("");
    setSelectedSession(sessionRow);

    if (!hasFaceRegistered) {
      setError(
        "Please register your facial data first using the 'Register Face ID' button above before marking attendance."
      );
      return;
    }

    // Step 1: Acquire GPS and verify location boundary FIRST
    const verifyLocationFirst = async (coords) => {
      setMarkingId(sessionRow.id);
      try {
        const locCheck = await apiFetch("/api/attendance/verify-location", token, {
          method: "POST",
          body: JSON.stringify({
            session_id: sessionRow.id,
            latitude: coords.latitude,
            longitude: coords.longitude,
            gps_accuracy_meters: coords.accuracy
          })
        });

        setDistancePreview(locCheck.verification);

        if (!locCheck.has_face_registered) {
          setError("Please register your facial data first.");
          return;
        }

        // Step 2: Inside geofence! Now open facial + background verification modal
        setFaceVerifyContext({
          session: sessionRow,
          coords,
          verification: locCheck.verification
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setMarkingId(null);
      }
    };

    captureStudentGps(verifyLocationFirst);
  }


  async function handleCompleteFaceVerification({ faceDescriptor, backgroundSignature }) {
    if (!faceVerifyContext) return;
    const { session: sessionRow, coords } = faceVerifyContext;

    const res = await apiFetch("/api/attendance/mark", token, {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionRow.id,
        latitude: coords.latitude,
        longitude: coords.longitude,
        gps_accuracy_meters: coords.accuracy,
        face_descriptor: faceDescriptor,
        background_signature: backgroundSignature
      })
    });

    setFaceVerifyContext(null);
    setSuccess(
      `${res.message} — Distance: ${res.verification.distance_meters}m (Face match: ${res.face_verification.distance})`
    );
    await loadMyHistory();
    onRefresh();
  }


  function exportMyHistoryCsv() {
    if (!myAttendance.records.length) return;
    const headers = [
      "Session",
      "Location",
      "Status",
      "Face Verified",
      "Background Verified",
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
      r.face_verified ? "Yes" : "No",
      r.background_verified ? "Yes" : "No",
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
      {/* Top Row: Student Profile (Roll No.) & Face ID Registration */}
      <div className="grid gap-4 lg:grid-cols-12">
        <form
          onSubmit={handleSaveProfile}
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-6"
        >
          <div className="flex w-full items-center gap-2 text-sm font-bold text-slate-900">
            <UserCircle2 className="text-blue-600" size={18} />
            <span>Student Profile & Roll No.</span>
          </div>

          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
              Full Name
            </label>
            <input
              required
              maxLength={100}
              value={fullNameInput}
              onChange={(e) => setFullNameInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500"
            />
          </div>

          <div className="w-40">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">
              Roll No.
            </label>
            <input
              maxLength={40}
              value={rollNoInput}
              onChange={(e) => setRollNoInput(e.target.value)}
              placeholder="e.g. 202651001"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs uppercase outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Save size={14} />
            {savingProfile ? "Saving..." : "Save"}
          </button>
        </form>

        <div
          className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 lg:col-span-6 ${
            hasFaceRegistered
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div
              className={`rounded-xl p-2.5 ${
                hasFaceRegistered
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              <ScanFace size={22} />
            </div>
            <div>
              <h3
                className={`text-sm font-bold ${
                  hasFaceRegistered ? "text-emerald-950" : "text-amber-950"
                }`}
              >
                {hasFaceRegistered
                  ? "Face ID Registered & Active"
                  : "Facial Data Not Registered Yet"}
              </h3>
              <p
                className={`text-xs ${
                  hasFaceRegistered ? "text-emerald-700" : "text-amber-800"
                }`}
              >
                {hasFaceRegistered
                  ? "Multi-pose Face ID ready for fast check-in."
                  : "Register 4 quick poses (blink, left, right, tilt) for fast recognition."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setFaceRegisterModalOpen(true)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
              hasFaceRegistered
                ? "border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50"
                : "bg-amber-600 text-white hover:bg-amber-700"
            }`}
          >
            <ScanFace size={15} />
            {hasFaceRegistered ? "Update Face ID" : "Register Face ID"}
          </button>
        </div>
      </div>

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
                Step 1 checks GPS boundary; Step 2 verifies Face ID & classroom background.
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
                            ? "Checking Location..."
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
              Complete log of your geo-tagged, face-verified, and classroom-verified attendance records.
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
                <th className="p-4">Verification</th>
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
                  <td className="p-4 text-xs">
                    <div className="flex flex-wrap gap-1.5">
                      {r.face_verified && (
                        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
                          Face
                        </span>
                      )}
                      {r.background_verified && (
                        <span className="rounded-full bg-purple-50 px-2.5 py-0.5 font-semibold text-purple-700">
                          Classroom
                        </span>
                      )}
                    </div>
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

      {/* Modal 1: Register / Update Multi-Pose Face ID */}
      <FaceCaptureModal
        isOpen={faceRegisterModalOpen}
        mode="register"
        onClose={() => setFaceRegisterModalOpen(false)}
        onCapture={handleSaveFaceRegistration}
      />

      {/* Modal 2: Verify Face & Classroom Background after passing Location Check */}
      <FaceCaptureModal
        isOpen={Boolean(faceVerifyContext)}
        mode="verify"
        subtitle={
          faceVerifyContext
            ? `Location verified (${faceVerifyContext.verification.distance_meters}m from ${faceVerifyContext.session.location?.name}). Blink & look at the camera for automatic verification.`
            : ""
        }
        onClose={() => setFaceVerifyContext(null)}
        onCapture={handleCompleteFaceVerification}
      />
    </div>
  );
}
