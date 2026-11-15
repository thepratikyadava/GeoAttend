import { useEffect, useState } from "react";

import {
  MapPin,
  Users,
  CalendarCheck,
  ShieldCheck,
  Activity,
  RefreshCw,
  Navigation
} from "lucide-react";

import StatusCard from "./components/StatusCard";

import {
  checkBackend,
  checkSupabase
} from "./lib/api";

import { supabase } from "./lib/supabase";


export default function App() {

  const [backendStatus, setBackendStatus] =
    useState("checking");

  const [databaseStatus, setDatabaseStatus] =
    useState("checking");

  const [lastChecked, setLastChecked] =
    useState(null);


  async function runChecks() {

    setBackendStatus("checking");
    setDatabaseStatus("checking");

    const backend = await checkBackend()
      .then(() => "connected")
      .catch(() => "disconnected");

    setBackendStatus(backend);

    if (backend === "connected") {

      const database = await checkSupabase()
        .then(() => "connected")
        .catch(() => "disconnected");

      setDatabaseStatus(database);

    } else {

      setDatabaseStatus("disconnected");

    }

    setLastChecked(new Date());

  }


  useEffect(() => {
    runChecks();
  }, []);


  const stats = [
    {
      title: "Total Students",
      value: "Not configured",
      icon: Users
    },
    {
      title: "Attendance Today",
      value: "Not configured",
      icon: CalendarCheck
    },
    {
      title: "Active Locations",
      value: "Not configured",
      icon: MapPin
    },
    {
      title: "Verified Sessions",
      value: "Not configured",
      icon: ShieldCheck
    }
  ];


  return (

    <div className="min-h-screen bg-slate-50 text-slate-900">

      <header className="border-b border-slate-200 bg-white">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">

          <div className="flex items-center gap-3">

            <div className="rounded-xl bg-blue-600 p-2 text-white">
              <Navigation size={23} />
            </div>

            <div>
              <h1 className="text-xl font-bold">
                GeoAttend
              </h1>

              <p className="text-xs text-slate-500">
                Location-based attendance management
              </p>
            </div>

          </div>

          <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
            DEVELOPMENT
          </span>

        </div>

      </header>


      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10">

        <section>

          <p className="text-sm font-medium text-blue-600">
            PROJECT OVERVIEW
          </p>

          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            Welcome to GeoAttend
          </h2>

          <p className="mt-2 max-w-2xl text-slate-500">
            A GPS-based geofenced attendance management
            system designed to simplify and verify
            location-based attendance.
          </p>

        </section>


        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

          {stats.map((item) => {

            const Icon = item.icon;

            return (

              <div
                key={item.title}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >

                <div className="flex items-center justify-between">

                  <p className="text-sm text-slate-500">
                    {item.title}
                  </p>

                  <Icon className="text-blue-600" size={21} />

                </div>

                <p className="mt-5 text-xl font-semibold text-slate-400">
                  {item.value}
                </p>

              </div>

            );

          })}

        </section>


        <section className="space-y-4">

          <div className="flex items-center justify-between">

            <div>
              <h3 className="text-lg font-semibold">
                System connectivity
              </h3>

              <p className="text-sm text-slate-500">
                Verify your application infrastructure.
              </p>
            </div>

            <button
              onClick={runChecks}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >

              <RefreshCw size={16} />
              Refresh

            </button>

          </div>


          <div className="grid gap-4 md:grid-cols-3">

            <StatusCard
              title="FastAPI Backend"
              description="Application API server"
              status={backendStatus}
            />

            <StatusCard
              title="Supabase Database"
              description="PostgreSQL connection through RPC"
              status={databaseStatus}
            />

            <StatusCard
              title="Supabase Client"
              description="Frontend configuration"
              status={supabase ? "connected" : "disconnected"}
            />

          </div>

          <p className="text-xs text-slate-400">
            Last checked: {
              lastChecked
                ? lastChecked.toLocaleTimeString()
                : "Checking..."
            }
          </p>

        </section>


        <section className="rounded-2xl border border-slate-200 bg-white p-6">

          <div className="flex items-center gap-3">

            <Activity className="text-blue-600" />

            <h3 className="font-semibold">
              Development roadmap
            </h3>

          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

            {[
              "Authentication",
              "GPS and Geofencing",
              "Attendance Management",
              "Analytics and Reports"
            ].map((item, index) => (

              <div
                key={item}
                className="rounded-xl bg-slate-50 p-4"
              >

                <p className="text-xs text-blue-600">
                  MODULE 0{index + 1}
                </p>

                <p className="mt-2 font-medium">
                  {item}
                </p>

                <p className="mt-2 text-xs text-slate-400">
                  Planned
                </p>

              </div>

            ))}

          </div>

        </section>


        <footer className="border-t border-slate-200 pt-5 text-center text-xs text-slate-400">

          GeoAttend EC161 Project · Built with React,
          FastAPI and Supabase

        </footer>

      </main>

    </div>

  );

}