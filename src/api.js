// Thin fetch wrapper around the /api serverless backend.
// All calls are same-origin (frontend + API deploy together on Vercel),
// so no base URL or CORS handling is needed.

async function req(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(`API ${path} failed: ${msg}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Fares ─────────────────────────────────────────────────────────────────
export const getFares = () => req("fares");
export const updateFare = (origin, destination, fare) =>
  req("fares", {
    method: "PATCH",
    body: JSON.stringify({ origin, destination, fare }),
  });

// ── Drivers ───────────────────────────────────────────────────────────────
export const getDrivers = () => req("drivers");
export const updateDriver = (id, patch) =>
  req(`drivers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });

// ── Tricycles ─────────────────────────────────────────────────────────────
export const getTricycles = () => req("tricycles");

// ── Dispatch requests ─────────────────────────────────────────────────────
export const createRequest = (origin, destination, fare) =>
  req("requests", {
    method: "POST",
    body: JSON.stringify({ origin, destination, fare }),
  });

export const getRequests = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return req(`requests${qs ? `?${qs}` : ""}`);
};

export const getRequestById = (id) => req(`requests/${id}`);

export const acceptRequest = (id, driverId) =>
  req(`requests/${id}/accept`, {
    method: "POST",
    body: JSON.stringify({ driverId }),
  });

export const completeRequest = (id) =>
  req(`requests/${id}/complete`, { method: "POST" });
