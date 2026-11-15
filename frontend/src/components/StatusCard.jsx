import { CheckCircle2, XCircle, LoaderCircle } from "lucide-react";

export default function StatusCard({
  title,
  description,
  status
}) {

  const isLoading = status === "checking";
  const isConnected = status === "connected";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-center justify-between">

        <h3 className="font-semibold text-slate-800">
          {title}
        </h3>

        {isLoading ? (
          <LoaderCircle className="animate-spin text-blue-500" />
        ) : isConnected ? (
          <CheckCircle2 className="text-emerald-500" />
        ) : (
          <XCircle className="text-red-500" />
        )}

      </div>

      <p className="mt-2 text-sm text-slate-500">
        {description}
      </p>

      <div className="mt-4">

        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          isLoading
            ? "bg-blue-50 text-blue-600"
            : isConnected
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-600"
        }`}>

          {isLoading
            ? "Checking..."
            : isConnected
            ? "Connected"
            : "Disconnected"}

        </span>

      </div>

    </div>
  );
}