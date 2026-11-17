const RAW_API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";

const API_URL = RAW_API_URL.trim().replace(/\/+$/, "");


export async function apiFetch(path, token, options = {}) {

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_URL}${normalizedPath}`;

  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...options.headers
    }
  };

  let response;

  try {
    response = await fetch(url, fetchOptions);
    // Retry once on Render cold-start 502/503/504 responses
    if (response.status >= 502 && response.status <= 504) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await fetch(url, fetchOptions);
    }
  } catch (networkErr) {
    // Retry once on transient network wake-up error
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await fetch(url, fetchOptions);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {

    throw new Error(
      data.detail || `Request failed (${response.status})`
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
