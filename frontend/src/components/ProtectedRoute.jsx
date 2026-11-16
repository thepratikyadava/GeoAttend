import { Navigate } from "react-router-dom";
import { RefreshCw, LogOut, AlertTriangle } from "lucide-react";

import { useAuth } from "../context/AuthContext";


export default function ProtectedRoute({
  children,
  requiredRole
}) {

  const {
    session,
    profile,
    loading,
    authError,
    refreshProfile,
    signOut
  } = useAuth();


  if (loading) {

    return (

      <div className="flex min-h-screen items-center justify-center bg-slate-50">

        <div className="text-center">

          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />

          <p className="mt-4 text-sm text-slate-500">
            Loading your GeoAttend account...
          </p>

        </div>

      </div>

    );

  }


  if (!session) {

    return <Navigate to="/login" replace />;

  }


  if (!profile) {

    return (

      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">

        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">

          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertTriangle size={24} />
          </div>

          <h2 className="text-lg font-semibold text-slate-900">
            Unable to load your profile
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            {authError || "Please check that the FastAPI backend is running and your Supabase Phase 2 schema is installed."}
          </p>

          <div className="mt-6 flex items-center justify-center gap-3">

            <button
              onClick={() => refreshProfile()}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw size={16} />
              Retry
            </button>

            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={16} />
              Sign out
            </button>

          </div>

        </div>

      </div>

    );

  }


  if (requiredRole && profile.role !== requiredRole) {

    return (

      <Navigate
        to={
          profile.role === "admin"
            ? "/admin"
            : "/student"
        }
        replace
      />

    );

  }


  return children;

}
