import { useEffect, useState, useCallback } from "react";

import {
  Users,
  MapPin,
  CalendarCheck,
  ShieldCheck,
  LogOut,
  Navigation,
  Building2,
  BarChart3,
  LayoutDashboard,
  RefreshCw
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";

import AdminLocationsPanel from "../components/AdminLocationsPanel";
import AdminSessionsPanel from "../components/AdminSessionsPanel";
import AdminAnalyticsPanel from "../components/AdminAnalyticsPanel";
import StudentAttendancePanel from "../components/StudentAttendancePanel";


export default function Dashboard() {

  const {
    session,
    profile,
    institution: contextInstitution,
    refreshProfile,
    signOut
  } = useAuth();

  const isAdmin = profile?.role === "admin";

  const [activeTab, setActiveTab] = useState(
    isAdmin ? "overview" : "attendance"
  );

  const [users, setUsers] = useState([]);
  const [institution, setInstitution] = useState(contextInstitution);
  const [locations, setLocations] = useState([]);
  const [sessions, setSessions] = useState([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Onboarding state for accounts not yet linked to an institution
  const [onboardMode, setOnboardMode] = useState("join");
  const [joinCode, setJoinCode] = useState("");
  const [newInstName, setNewInstName] = useState("");
  const [newInstCode, setNewInstCode] = useState("");
  const [onboardSubmitting, setOnboardSubmitting] = useState(false);
  const [onboardMessage, setOnboardMessage] = useState("");


  useEffect(() => {
    if (contextInstitution) {
      setInstitution(contextInstitution);
    }
  }, [contextInstitution]);


  const loadDashboardData = useCallback(async () => {

    if (!session?.access_token || !profile?.institution_id) return;

    setLoading(true);
    setError("");

    try {

      const promises = [
        apiFetch("/api/locations", session.access_token),
        apiFetch("/api/sessions", session.access_token)
      ];

      if (isAdmin) {
        promises.push(
          apiFetch("/api/admin/users", session.access_token),
          apiFetch("/api/admin/institution", session.access_token)
        );
      }

      const results = await Promise.all(promises);

      setLocations(results[0]?.locations || []);
      setSessions(results[1]?.sessions || []);

      if (isAdmin) {
        setUsers(results[2]?.users || []);
        setInstitution(results[3] || contextInstitution);
      }

    } catch (err) {

      // Fallback to direct Supabase RLS queries if Render is waking up or unreachable
      if (supabase && profile?.institution_id) {
        try {
          const { data: locData } = await supabase
            .from("locations")
            .select("*")
            .eq("institution_id", profile.institution_id)
            .order("created_at", { ascending: false });

          const locs = locData || [];
          setLocations(locs);

          if (locs.length > 0) {
            const locMap = Object.fromEntries(locs.map((l) => [l.id, l]));
            const { data: sessData } = await supabase
              .from("sessions")
              .select("*")
              .in_("location_id", locs.map((l) => l.id))
              .order("start_time", { ascending: false });

            const nowMs = Date.now();
            setSessions(
              (sessData || []).map((s) => {
                const startMs = new Date(s.start_time).getTime();
                const endMs = new Date(s.end_time).getTime();
                const timing = !s.is_active
                  ? "closed"
                  : nowMs < startMs
                  ? "upcoming"
                  : nowMs > endMs
                  ? "ended"
                  : "ongoing";
                return {
                  ...s,
                  location: locMap[s.location_id] || null,
                  timing_status: timing
                };
              })
            );
          }
          setError("");
          return;
        } catch {
          // Fall through to show original error
        }
      }

      setError(err.message);

    } finally {

      setLoading(false);

    }

  }, [session?.access_token, profile?.institution_id, isAdmin, contextInstitution]);


  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);


  async function handleLogout() {
    try {
      await signOut();
    } catch (err) {
      setError(err.message);
    }
  }


  async function handleInstitutionOnboarding(e) {
    e.preventDefault();
    setError("");
    setOnboardMessage("");
    setOnboardSubmitting(true);

    try {
      if (onboardMode === "join") {
        await apiFetch("/api/institutions/join", session.access_token, {
          method: "POST",
          body: JSON.stringify({
            institution_code: joinCode.trim().toUpperCase()
          })
        });
        setOnboardMessage("Successfully joined institution!");
      } else {
        await apiFetch("/api/institutions/create", session.access_token, {
          method: "POST",
          body: JSON.stringify({
            name: newInstName.trim(),
            code: newInstCode.trim().toUpperCase()
          })
        });
        setOnboardMessage("Institution created and administrator role assigned!");
      }

      await refreshProfile();
    } catch (err) {
      setError(err.message);
    } finally {
      setOnboardSubmitting(false);
    }
  }


  const studentCount = users.filter((u) => u.role === "student").length;
  const ongoingSessionsCount = sessions.filter(
    (s) => s.timing_status === "ongoing"
  ).length;


  const cards = [
    {
      label: isAdmin ? "Registered Students" : "Available Sessions",
      value: isAdmin ? studentCount : sessions.length,
      icon: Users
    },
    {
      label: "Geofence Locations",
      value: locations.length,
      icon: MapPin
    },
    {
      label: "Ongoing Sessions",
      value: ongoingSessionsCount,
      icon: CalendarCheck
    },
    {
      label: "Account Role",
      value: profile?.role,
      icon: ShieldCheck
    }
  ];


  const adminTabs = [
    { id: "overview", label: "Overview & Users", icon: LayoutDashboard },
    { id: "locations", label: "Locations & Geofences", icon: MapPin },
    { id: "sessions", label: "Sessions & Check-Ins", icon: CalendarCheck },
    { id: "analytics", label: "Analytics & Reports", icon: BarChart3 }
  ];


  return (

    <div className="min-h-screen bg-slate-50">

      <header className="border-b border-slate-200 bg-white">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">

          <div className="flex items-center gap-3">

            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <Navigation size={22} />
            </div>

            <div>

              <h1 className="text-xl font-bold text-slate-900">
                GeoAttend
              </h1>

              <p className="text-xs text-slate-500">
                GPS & Geofenced Attendance System
              </p>

            </div>

          </div>


          <div className="flex items-center gap-3">

            {profile?.institution_id && (
              <button
                type="button"
                onClick={loadDashboardData}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw size={14} />
                Sync
              </button>
            )}

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={16} />
              Sign out
            </button>

          </div>

        </div>

      </header>


      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">

        <div className="flex flex-wrap items-end justify-between gap-4">

          <section>

            <p className="text-xs font-bold tracking-wider text-blue-600 uppercase">
              {isAdmin ? "ADMINISTRATOR WORKSPACE" : "STUDENT PORTAL"}
            </p>

            <h2 className="mt-1 text-3xl font-bold text-slate-900">
              Welcome, {profile?.full_name || "User"}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {isAdmin
                ? "Configure campus geofences, schedule attendance sessions, and export analytics."
                : "Verify your live GPS coordinates inside active campus geofences to mark attendance."}
            </p>

          </section>


          {institution && (

            <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">

              <Building2 className="text-blue-600" size={22} />

              <div>

                <p className="text-sm font-bold text-blue-950">
                  {institution.name}
                </p>

                <p className="text-xs font-medium text-blue-700">
                  Institution Code:{" "}
                  <span className="font-mono font-bold">
                    {institution.code}
                  </span>
                </p>

              </div>

            </div>

          )}

        </div>


        {error && (
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
            {error}
          </p>
        )}

        {onboardMessage && (
          <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
            {onboardMessage}
          </p>
        )}


        {/* Institution Onboarding Flow if account has no institution_id */}
        {!profile?.institution_id ? (

          <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">

            <h3 className="text-lg font-bold text-slate-900">
              Link Your Account to an Institution
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Join an existing institution using an administrator code, or create a new institution as its administrator.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setOnboardMode("join")}
                className={`rounded-lg py-2 text-xs font-semibold ${
                  onboardMode === "join"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-600"
                }`}
              >
                Join as Student
              </button>
              <button
                type="button"
                onClick={() => setOnboardMode("create")}
                className={`rounded-lg py-2 text-xs font-semibold ${
                  onboardMode === "create"
                    ? "bg-white text-blue-600 shadow-xs"
                    : "text-slate-600"
                }`}
              >
                Create as Admin
              </button>
            </div>

            <form onSubmit={handleInstitutionOnboarding} className="mt-4 space-y-4">
              {onboardMode === "join" ? (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                    Institution Code
                  </label>
                  <input
                    required
                    maxLength={20}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="e.g. IIITVDIU"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm uppercase outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                      Institution Name
                    </label>
                    <input
                      required
                      maxLength={120}
                      value={newInstName}
                      onChange={(e) => setNewInstName(e.target.value)}
                      placeholder="e.g. IIIT Vadodara - International Campus Diu"
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
                      Institution Code
                    </label>
                    <input
                      required
                      maxLength={20}
                      value={newInstCode}
                      onChange={(e) => setNewInstCode(e.target.value)}
                      placeholder="e.g. IIITVDIU"
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm uppercase outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={onboardSubmitting}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {onboardSubmitting
                  ? "Saving..."
                  : onboardMode === "join"
                  ? "Join Institution"
                  : "Create Institution & Become Admin"}
              </button>
            </form>

          </section>

        ) : (

          <>

            {/* Top Metric Cards */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

              {cards.map((card) => {

                const Icon = card.icon;

                return (

                  <div
                    key={card.label}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >

                    <div className="flex justify-between">

                      <p className="text-sm text-slate-500">
                        {card.label}
                      </p>

                      <Icon className="text-blue-600" size={20} />

                    </div>

                    <p className="mt-4 text-2xl font-bold capitalize text-slate-900">
                      {card.value}
                    </p>

                  </div>

                );

              })}

            </section>


            {/* Administrator Navigation Tabs & Panels */}
            {isAdmin ? (

              <>

                <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">

                  {adminTabs.map((tab) => {

                    const Icon = tab.icon;
                    const active = activeTab === tab.id;

                    return (

                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                          active
                            ? "bg-blue-600 text-white shadow-xs"
                            : "bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <Icon size={16} />
                        {tab.label}
                      </button>

                    );

                  })}

                </div>


                {activeTab === "overview" && (

                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">

                    <div className="border-b border-slate-200 p-5">

                      <h3 className="text-lg font-semibold text-slate-900">
                        Institution Users ({users.length})
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        Administrators and students registered under {institution?.name || "your institution"}.
                      </p>

                    </div>


                    {loading ? (

                      <p className="p-6 text-sm text-slate-500">
                        Loading users...
                      </p>

                    ) : (

                      <div className="overflow-x-auto">

                        <table className="w-full text-left text-sm">

                          <thead className="bg-slate-50 text-slate-500">

                            <tr>
                              <th className="p-4">Name</th>
                              <th className="p-4">Roll No.</th>
                              <th className="p-4">Role</th>
                              <th className="p-4">Joined</th>
                              <th className="p-4">User ID</th>
                            </tr>

                          </thead>

                          <tbody>

                            {users.map((user) => (

                              <tr
                                key={user.id}
                                className="border-t border-slate-100"
                              >

                                <td className="p-4 font-medium text-slate-900">
                                  {user.full_name || "Unnamed user"}
                                </td>

                                <td className="p-4 font-mono text-xs text-slate-600">
                                  {user.roll_no || "—"}
                                </td>

                                <td className="p-4">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                                      user.role === "admin"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {user.role}
                                  </span>
                                </td>

                                <td className="p-4 text-xs text-slate-500">
                                  {user.created_at
                                    ? new Date(user.created_at).toLocaleDateString()
                                    : "-"}
                                </td>

                                <td className="p-4 font-mono text-xs text-slate-400">
                                  {user.id.slice(0, 8)}...
                                </td>

                              </tr>

                            ))}

                            {users.length === 0 && (

                              <tr>
                                <td
                                  colSpan="5"
                                  className="p-6 text-center text-slate-400"
                                >
                                  No registered users found.
                                </td>
                              </tr>

                            )}

                          </tbody>

                        </table>

                      </div>

                    )}

                  </section>

                )}


                {activeTab === "locations" && (

                  <AdminLocationsPanel
                    token={session.access_token}
                    locations={locations}
                    onRefresh={loadDashboardData}
                  />

                )}


                {activeTab === "sessions" && (

                  <AdminSessionsPanel
                    token={session.access_token}
                    locations={locations}
                    sessions={sessions}
                    onRefresh={loadDashboardData}
                  />

                )}


                {activeTab === "analytics" && (

                  <AdminAnalyticsPanel
                    token={session.access_token}
                  />

                )}

              </>

            ) : (

              /* Student Portal View */
              <StudentAttendancePanel
                token={session.access_token}
                profile={profile}
                locations={locations}
                sessions={sessions}
                onRefresh={loadDashboardData}
                onRefreshProfile={refreshProfile}
              />

            )}

          </>

        )}

      </main>

    </div>

  );

}
