const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";


export async function checkBackend() {

  const response = await fetch(`${API_URL}/api/health`);

  if (!response.ok) {
    throw new Error("Backend is unavailable");
  }

  return response.json();
}


export async function checkSupabase() {

  const response = await fetch(
    `${API_URL}/api/supabase-health`
  );

  if (!response.ok) {
    throw new Error("Supabase connection failed");
  }

  return response.json();
}