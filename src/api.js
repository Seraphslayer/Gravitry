// Thin fetch wrapper around the /api serverless backend.
// All calls are same-origin (frontend + API deploy together on Vercel).

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

// ── Auth ──────────────────────────────────────────────────────────────────
export const login = (username, password) =>
  req("auth?action=login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

export const signup = (username, password, name, phone) =>
  req("auth?action=signup", {
    method: "POST",
    body: JSON.stringify({ username, password, name, phone }),
  });

export const logout = () => req("auth?action=logout", { method: "POST" });

export const getMe = () => req("auth?action=me");

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
  req(`drivers?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// ── Tricycles ─────────────────────────────────────────────────────────────
export const getTricycles = () => req("tricycles");

// ── Dispatch requests ─────────────────────────────────────────────────────
// passenger is optional: { id, name } — attaches identity for logged-in passengers
export const createRequest = (origin, destination, fare, passenger) =>
  req("requests", {
    method: "POST",
    body: JSON.stringify({
      origin,
      destination,
      fare,
      ...(passenger
        ? { passengerId: passenger.id, passengerName: passenger.name }
        : {}),
    }),
  });

export const getRequests = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return req(`requests${qs ? `?${qs}` : ""}`);
};

export const getRequestById = (id) =>
  req(`requests?id=${encodeURIComponent(id)}`);

export const acceptRequest = (id, driverId) =>
  req(`requests?id=${encodeURIComponent(id)}&action=accept`, {
    method: "POST",
    body: JSON.stringify({ driverId }),
  });

export const completeRequest = (id) =>
  req(`requests?id=${encodeURIComponent(id)}&action=complete`, {
    method: "POST",
  });
