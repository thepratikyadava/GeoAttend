import { useState, useEffect } from "react";

import { Link, useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

import { useAuth } from "../context/AuthContext";

import { Navigation, ShieldCheck, UserCheck } from "lucide-react";


export default function Login() {

  const navigate = useNavigate();

  const { session, profile, loading, loginWithRole } = useAuth();


  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [error, setError] = useState("");

  const [submitting, setSubmitting] = useState(false);


  useEffect(() => {

    if (!loading && session && profile) {

      navigate(
        profile.role === "admin"
          ? "/admin"
          : "/student",
        { replace: true }
      );

    }

  }, [loading, session, profile, navigate]);


  async function handleLogin(event) {

    event.preventDefault();

    setError("");
    setSubmitting(true);

    const normalizedEmail = email.trim().toLowerCase();

    try {

      // Support built-in Admin & Student credentials directly
      if (normalizedEmail === "admin@iiitvadodara.ac.in") {
        await loginWithRole("admin");
        return;
      }

      if (normalizedEmail === "student@iiitvadodara.ac.in") {
        await loginWithRole("student");
        return;
      }

      if (!supabase) {
        throw new Error("Supabase client is not configured.");
      }

      const { error: signInError } =
        await supabase.auth.signInWithPassword({

          email: normalizedEmail,
          password

        });

      if (signInError) throw signInError;

    } catch (err) {

      setError(err.message);

    } finally {

      setSubmitting(false);

    }

  }


  async function handleQuickRoleLogin(role) {
    setError("");
    setSubmitting(true);
    try {
      await loginWithRole(role);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }


  return (

    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">

      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">

        <div className="mb-7 text-center">

          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">

            <Navigation size={28} />

          </div>

          <h1 className="text-2xl font-bold">
            Welcome to GeoAttend
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Sign in to your attendance account
          </p>

        </div>


        <form
          onSubmit={handleLogin}
          className="space-y-4"
        >

          <div>

            <label className="mb-2 block text-sm font-medium">
              Email address
            </label>

            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="admin@iiitvadodara.ac.in"
            />

          </div>


          <div>

            <label className="mb-2 block text-sm font-medium">
              Password
            </label>

            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="Enter your password"
            />

          </div>


          {error && (

            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>

          )}


          <button
            disabled={submitting}
            className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >

            {submitting ? "Signing in..." : "Sign in"}

          </button>

        </form>


        <div className="mt-6 border-t border-slate-100 pt-5">

          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
            Instant Role Access (IIITVDIU)
          </p>

          <div className="grid grid-cols-2 gap-2.5">

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleQuickRoleLogin("admin")}
              className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <ShieldCheck size={15} />
              Run as Admin
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleQuickRoleLogin("student")}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <UserCheck size={15} />
              Run as Student
            </button>

          </div>

        </div>


        <p className="mt-6 text-center text-sm text-slate-500">

          Don't have an account?{" "}

          <Link
            to="/register"
            className="font-semibold text-blue-600"
          >
            Register
          </Link>

        </p>

      </div>

    </div>

  );

}
