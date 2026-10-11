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

// -- Auth ---------------------------------------------------------------
export const login = (username, password) =>
  req("auth?action=login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

// data: { username, password, name, phone, address, idPhoto, selfie, consent }
export const signup = (data) =>
  req("auth?action=signup", {
    method: "POST",
    body: JSON.stringify(data),
  });

// data: { idPhoto, selfie, consent } - for a rejected/pending passenger
export const resubmitVerification = (data) =>
  req("auth?action=resubmit", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const logout = () => req("auth?action=logout", { method: "POST" });

export const getMe = () => req("auth?action=me");

// -- Fares ----------------------------------------------------------------
export const getFares = () => req("fares");
export const updateFare = (origin, destination, fare) =>
  req("fares", {
    method: "PATCH",
    body: JSON.stringify({ origin, destination, fare }),
  });

// -- Drivers ----------------------------------------------------------------
export const getDrivers = () => req("drivers");
export const updateDriver = (id, patch) =>
  req(`drivers?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// -- Tricycles ----------------------------------------------------------------
export const getTricycles = () => req("tricycles");

// -- Dispatch requests ----------------------------------------------------------------
// passenger is optional: { id, name } - attaches identity for logged-in passengers
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

// NFC card tap (keyboard-emulation reader at a physical terminal). No key
// header - see api/requests.js for how this endpoint protects itself
// without a secret the browser could leak.
export const acceptViaNfc = (nfcId, origin) =>
  req("requests?action=nfc-accept", {
    method: "POST",
    body: JSON.stringify({ nfcId, origin }),
  });

// -- Passenger verification (admin only) ----------------------------------------------------------------
export const getVerifications = () => req("verifications");
export const getVerificationPhotos = (id) =>
  req(`verifications?id=${encodeURIComponent(id)}`);
export const reviewVerification = (id, decision, reason) =>
  req(`verifications?id=${encodeURIComponent(id)}&action=${decision}`, {
    method: "POST",
    body: JSON.stringify(decision === "reject" ? { reason } : {}),
  });
