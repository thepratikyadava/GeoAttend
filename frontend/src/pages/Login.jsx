import { useState, useEffect } from "react";

import { Link, useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

import { useAuth } from "../context/AuthContext";

import { Navigation } from "lucide-react";


export default function Login() {

  const navigate = useNavigate();

  const { session, profile, loading } = useAuth();


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

    if (!supabase) {
      setError("Supabase client is not configured.");
      return;
    }

    setSubmitting(true);

    try {

      const { error: signInError } =
        await supabase.auth.signInWithPassword({

          email: email.trim(),
          password

        });

      if (signInError) throw signInError;

    } catch (err) {

      setError(err.message);

    } finally {

      setSubmitting(false);

    }

  }


  return (

    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">

      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">

        <div className="mb-8 text-center">

          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-xs">

            <Navigation size={28} />

          </div>

          <h1 className="text-2xl font-bold text-slate-900">
            Welcome to GeoAttend
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Sign in to your attendance account
          </p>

        </div>


        <form
          onSubmit={handleLogin}
          className="space-y-5"
        >

          <div>

            <label className="mb-2 block text-sm font-medium text-slate-700">
              Email address
            </label>

            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="you@example.com"
            />

          </div>


          <div>

            <label className="mb-2 block text-sm font-medium text-slate-700">
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


        <p className="mt-6 text-center text-sm text-slate-500">

          Don't have an account?{" "}

          <Link
            to="/register"
            className="font-semibold text-blue-600 hover:underline"
          >
            Register
          </Link>

        </p>

      </div>

    </div>

  );

}
