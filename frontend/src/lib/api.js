const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";


export async function apiFetch(path, token, options = {}) {

  const response = await fetch(`${API_URL}${path}`, {

    ...options,

    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...options.headers
    }

  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {

    throw new Error(
      data.detail || "Something went wrong"
    );

  }

  return data;
}


export async function checkBackend() {

  return apiFetch("/api/health", null);

}


export async function checkSupabase() {

  return apiFetch("/api/supabase-health", null);

}