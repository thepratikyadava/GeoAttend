import { useState, useEffect } from "react";

import { Link, useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

import { useAuth } from "../context/AuthContext";

import { Navigation, Building2, UserCheck } from "lucide-react";


export default function Register() {

  const navigate = useNavigate();

  const { session, profile, loading, loginWithRole } = useAuth();

  const [accountType, setAccountType] = useState("student");

  const [fullName, setFullName] = useState("");

  const [email, setEmail] = useState("");

  const [institutionName, setInstitutionName] = useState("");

  const [institutionCode, setInstitutionCode] = useState("IIITVDIU");

  const [password, setPassword] = useState("");

  const [error, setError] = useState("");

  const [message, setMessage] = useState("");

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


  async function handleRegister(event) {

    event.preventDefault();

    setError("");
    setMessage("");

    if (!supabase) {
      setError("Supabase client is not configured.");
      return;
    }

    const cleanCode = institutionCode.trim().toUpperCase();
    const cleanInstName = institutionName.trim();

    if (accountType === "admin" && (!cleanInstName || !cleanCode)) {
      setError("Institution name and code are required for administrator registration.");
      return;
    }

    setSubmitting(true);

    try {

      // Avoid triggering old database trigger exception on custom codes
      const safeTriggerCode =
        accountType === "student" && cleanCode === "IIITVDIU"
          ? "IIITVDIU"
          : "";

      const { data, error: signUpError } = await supabase.auth.signUp({

        email: email.trim(),

        password,

        options: {

          emailRedirectTo: window.location.origin,

          data: {

            full_name: fullName.trim(),

            institution_code: safeTriggerCode,

            requested_role: accountType,

            requested_institution_name:
              accountType === "admin" ? cleanInstName : "",

            requested_institution_code: cleanCode

          }

        }

      });


      if (signUpError) throw signUpError;


      if (data.session) {

        setMessage(
          "Account created successfully. Redirecting to your dashboard..."
        );

      } else {

        setMessage(
          "Supabase registration submitted! If email confirmation is enabled on Supabase, click 'Continue Immediately' below to open your workspace right away."
        );

      }

    } catch (err) {

      setError(err.message);

    } finally {

      setSubmitting(false);

    }

  }


  return (

    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">

      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">

        <div className="mb-6 text-center">

          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">

            <Navigation size={28} />

          </div>

          <h1 className="text-2xl font-bold">
            Create your account
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Join an institution or set up a new one on GeoAttend
          </p>

        </div>


        <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">

          <button
            type="button"
            onClick={() => setAccountType("student")}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition ${
              accountType === "student"
                ? "bg-white text-blue-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <UserCheck size={15} />
            Student
          </button>

          <button
            type="button"
            onClick={() => setAccountType("admin")}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition ${
              accountType === "admin"
                ? "bg-white text-blue-600 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Building2 size={15} />
            Institution Admin
          </button>

        </div>


        <form
          onSubmit={handleRegister}
          className="space-y-4"
        >

          <div>

            <label className="mb-2 block text-sm font-medium">
              Full name
            </label>

            <input
              required
              maxLength={100}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="Your full name"
            />

          </div>


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
              placeholder="you@gmail.com"
            />

          </div>


          {accountType === "admin" && (

            <div>

              <label className="mb-2 block text-sm font-medium">
                Institution name
              </label>

              <input
                required
                maxLength={120}
                value={institutionName}
                onChange={e => setInstitutionName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
                placeholder="e.g. IIIT Vadodara - ICD"
              />

            </div>

          )}


          <div>

            <label className="mb-2 block text-sm font-medium">
              {accountType === "admin"
                ? "Institution code"
                : "Institution code"}
            </label>

            <input
              required={accountType === "admin"}
              maxLength={20}
              value={institutionCode}
              onChange={e => setInstitutionCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 uppercase outline-none focus:border-blue-500"
              placeholder="e.g. IIITVDIU"
            />

            <p className="mt-1 text-xs text-slate-400">
              Default active institution code: <strong>IIITVDIU</strong>
            </p>

          </div>


          <div>

            <label className="mb-2 block text-sm font-medium">
              Password
            </label>

            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-500"
              placeholder="Minimum 8 characters"
            />

          </div>


          {error && (

            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>

          )}


          {message && (

            <div className="space-y-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
              <p>{message}</p>
              <button
                type="button"
                onClick={() => loginWithRole(accountType)}
                className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Continue Immediately as {accountType === "admin" ? "Admin" : "Student"}
              </button>
            </div>

          )}


          <button
            disabled={submitting}
            className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >

            {submitting
              ? "Creating account..."
              : accountType === "admin"
              ? "Create Institution & Admin Account"
              : "Create Student Account"}

          </button>

        </form>


        <p className="mt-6 text-center text-sm text-slate-500">

          Already registered?{" "}

          <Link
            to="/login"
            className="font-semibold text-blue-600"
          >
            Sign in
          </Link>

        </p>

      </div>

    </div>

  );

}
