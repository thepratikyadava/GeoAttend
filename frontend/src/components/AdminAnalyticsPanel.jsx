import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { Download, RefreshCw, TrendingUp, Award } from "lucide-react";

import { apiFetch } from "../lib/api";


const PIE_COLORS = ["#10b981", "#f59e0b"];


export default function AdminAnalyticsPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");


  async function loadAnalytics() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch("/api/analytics/overview", token);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    loadAnalytics();
  }, [token]);


  function exportStudentReportCsv() {
    if (!data?.student_reports?.length) return;

    const headers = [
      "Student Name",
      "Student ID",
      "Present",
      "Late",
      "Total Attended",
      "Missed Sessions",
      "Total Sessions",
      "Attendance Rate (%)"
    ];

    const rows = data.student_reports.map((s) => [
      `"${(s.full_name || "").replace(/"/g, '""')}"`,
      s.student_id,
      s.present,
      s.late,
      s.attended,
      s.missed,
      s.total_sessions,
      s.attendance_rate
    ]);

    const csvContent =
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `geoattend_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading analytics and attendance reports...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { kpis, session_breakdown, student_reports } = data;

  const statusPieData = [
    { name: "Present (On Time)", value: kpis.present_count || 0 },
    { name: "Late", value: kpis.late_count || 0 }
  ];


  return (
    <div className="space-y-6">
      {/* Summary KPI Bar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Overall Attendance Rate
          </p>
          <p className="mt-3 text-3xl font-bold text-blue-600">
            {kpis.overall_attendance_rate}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Across {kpis.total_sessions} scheduled sessions
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Verified Check-Ins
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            {kpis.total_attendance_records}
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            {kpis.present_count} on-time · {kpis.late_count} late
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Active Geofences
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            {kpis.active_locations} / {kpis.total_locations}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Configured campus boundaries
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-semibold uppercase text-slate-400">
            Enrolled Students
          </p>
          <p className="mt-3 text-3xl font-bold text-slate-900">
            {kpis.total_students}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Registered under institution
          </p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Session Attendance Breakdown
              </h3>
              <p className="text-xs text-slate-500">
                Present, late, and absent counts across recent sessions.
              </p>
            </div>
            <button
              type="button"
              onClick={loadAnalytics}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {session_breakdown.length > 0 ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={session_breakdown}>
                  <XAxis dataKey="session_name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="present" name="Present" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="late" name="Late" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" name="Absent" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
              Create sessions and record attendance to view session charts.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-4">
          <h3 className="text-lg font-semibold text-slate-900">
            Punctuality Distribution
          </h3>
          <p className="text-xs text-slate-500">
            On-time vs late verified check-ins.
          </p>

          {kpis.total_attendance_records > 0 ? (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                  >
                    {statusPieData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">
              No verified attendance records yet.
            </div>
          )}
        </div>
      </div>

      {/* Student Attendance Report Table & CSV Export */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
          <div className="flex items-center gap-2.5">
            <Award className="text-blue-600" size={20} />
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Student Attendance Summary Report
              </h3>
              <p className="text-xs text-slate-500">
                Individual attendance percentages and session completion counts.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={exportStudentReportCsv}
            disabled={student_reports.length === 0}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Download size={15} />
            Export CSV Report
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="p-4">Student Name</th>
                <th className="p-4">Present</th>
                <th className="p-4">Late</th>
                <th className="p-4">Attended / Total</th>
                <th className="p-4">Missed</th>
                <th className="p-4">Attendance Rate</th>
              </tr>
            </thead>
            <tbody>
              {student_reports.map((st) => (
                <tr key={st.student_id} className="border-t border-slate-100">
                  <td className="p-4 font-semibold text-slate-900">
                    {st.full_name}
                  </td>
                  <td className="p-4 text-emerald-700 font-medium">
                    {st.present}
                  </td>
                  <td className="p-4 text-amber-700 font-medium">
                    {st.late}
                  </td>
                  <td className="p-4 text-slate-700">
                    {st.attended} / {st.total_sessions}
                  </td>
                  <td className="p-4 text-slate-500">
                    {st.missed}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            st.attendance_rate >= 75
                              ? "bg-emerald-500"
                              : st.attendance_rate >= 50
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(100, st.attendance_rate)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-800">
                        {st.attendance_rate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}

              {student_reports.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-400">
                    No students registered in your institution yet.
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
