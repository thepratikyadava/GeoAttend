import { useState, useEffect } from "react";

import { Link, useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

import { useAuth } from "../context/AuthContext";

import {
  Navigation,
  Building2,
  UserCheck,
  ScanFace,
  CheckCircle2
} from "lucide-react";

import FaceCaptureModal, { preloadFaceModels } from "../components/FaceCaptureModal";


export default function Register() {

  const navigate = useNavigate();

  const { session, profile, loading } = useAuth();

  const [accountType, setAccountType] = useState("student");

  const [fullName, setFullName] = useState("");

  const [rollNo, setRollNo] = useState("");

  const [email, setEmail] = useState("");

  const [institutionName, setInstitutionName] = useState("");

  const [institutionCode, setInstitutionCode] = useState("");

  const [password, setPassword] = useState("");

  const [faceDescriptor, setFaceDescriptor] = useState(null);

  const [faceModalOpen, setFaceModalOpen] = useState(false);

  const [error, setError] = useState("");

  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);


  useEffect(() => {
    preloadFaceModels().catch(() => {});
  }, []);


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

      const { data, error: signUpError } = await supabase.auth.signUp({

        email: email.trim(),

        password,

        options: {

          emailRedirectTo: window.location.origin,

          data: {

            full_name: fullName.trim(),

            roll_no: accountType === "student" ? rollNo.trim().toUpperCase() : "",

            role: accountType,

            institution_name:
              accountType === "admin" ? cleanInstName : "",

            institution_code: cleanCode,

            ...(faceDescriptor ? { face_descriptor: faceDescriptor } : {})

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
          "Registration successful. Please check your email to verify your account before signing in."
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

          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-xs">

            <Navigation size={28} />

          </div>

          <h1 className="text-2xl font-bold text-slate-900">
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

            <label className="mb-2 block text-sm font-medium text-slate-700">
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


          {accountType === "student" && (

            <div>

              <label className="mb-2 block text-sm font-medium text-slate-700">
                Roll No.
              </label>

              <input
                maxLength={40}
                value={rollNo}
                onChange={e => setRollNo(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 uppercase outline-none focus:border-blue-500"
                placeholder="e.g. 202651001"
              />

            </div>

          )}


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


          {accountType === "admin" && (

            <div>

              <label className="mb-2 block text-sm font-medium text-slate-700">
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

            <label className="mb-2 block text-sm font-medium text-slate-700">
              {accountType === "admin"
                ? "Create institution code"
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
              {accountType === "admin"
                ? "3–20 uppercase letters/numbers. Students will use this code to join."
                : "Obtain this code from your institution administrator (or join later from dashboard)."}
            </p>

          </div>


          <div>

            <label className="mb-2 block text-sm font-medium text-slate-700">
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


          {accountType === "student" && (

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">

              <div className="flex items-center justify-between gap-3">

                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Facial Data (Required for Attendance)
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {faceDescriptor
                      ? "Face ID captured and ready to save."
                      : "Scan your face now or after signing in."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setFaceModalOpen(true)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    faceDescriptor
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {faceDescriptor ? (
                    <>
                      <CheckCircle2 size={14} />
                      Captured
                    </>
                  ) : (
                    <>
                      <ScanFace size={14} />
                      Add Face ID
                    </>
                  )}
                </button>

              </div>

            </div>

          )}


          {error && (

            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>

          )}


          {message && (

            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
              {message}
            </p>

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
            className="font-semibold text-blue-600 hover:underline"
          >
            Sign in
          </Link>

        </p>

      </div>

      <FaceCaptureModal
        isOpen={faceModalOpen}
        mode="register"
        onClose={() => setFaceModalOpen(false)}
        onCapture={async (descriptor) => {
          setFaceDescriptor(descriptor);
          setFaceModalOpen(false);
        }}
      />

    </div>

  );

}
