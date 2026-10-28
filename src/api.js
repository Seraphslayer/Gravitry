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

// data: { username, password, name, phone, address, idPhoto, selfie, consent,
//         discountClaim?, discountIdPhoto? }
// discountClaim is "student" | "senior" | "pwd" (or omitted); when set,
// discountIdPhoto must be a photo of that ID.
export const signup = (data) =>
  req("auth?action=signup", {
    method: "POST",
    body: JSON.stringify(data),
  });

// data: { idPhoto, selfie, consent, discountIdPhoto? } - for a rejected/pending passenger
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
// Admin: every driver's last shared location -> [{ id, name, unit, live, location:{lat,lng,at}|null }]
export const getDriverLocations = () => req("drivers?action=locations");
// Admin: create one driver account. Blank password -> one is generated and
// returned (once). -> { id, name, username, password, generated }
export const createDriver = (data) =>
  req("drivers?action=create", { method: "POST", body: JSON.stringify(data) });
// Admin: create many from spreadsheet rows. -> { created, failed, results }
export const importDrivers = (rows) =>
  req("drivers?action=import", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
export const updateDriver = (id, patch) =>
  req(`drivers?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// Driver app heartbeat: tells the server whether this driver is Online. Sent when
// the driver taps Online / Offline and every ~15s while Online; the admin
// dashboard shows the driver as Active only while these keep arriving.
// position ({ lat, lng }) is the driver's live GPS, shared only so the passenger
// being picked up can watch them arrive.
export const sendPresence = (online, position) =>
  req("drivers?action=presence", {
    method: "POST",
    body: JSON.stringify({
      online,
      ...(position ? { lat: position.lat, lng: position.lng } : {}),
    }),
  });

// -- Tricycles ----------------------------------------------------------------
export const getTricycles = () => req("tricycles");

// All-rounder (TODA-owned, no owner) units that the TODA rents out to drivers
// without a tricycle. Rentals are open-ended and renew monthly. Admin only.
const tricyclePost = (query, body) =>
  req(`tricycles?${query}`, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
export const createTricycle = ({ unit, plate }) =>
  tricyclePost("action=create", { unit, plate });
export const rentTricycle = (id, driverId, startedAt) =>
  tricyclePost(`action=rent&id=${encodeURIComponent(id)}`, {
    driverId,
    startedAt,
  });
export const renewTricycleRental = (id) =>
  tricyclePost(`action=renew&id=${encodeURIComponent(id)}`);
export const releaseTricycle = (id) =>
  tricyclePost(`action=release&id=${encodeURIComponent(id)}`);

// -- Dispatch requests ----------------------------------------------------------------
// source is "kiosk" for rides made at the kiosk. Logged-in passengers are
// identified by their session cookie.
// discountClaim ("student" | "senior" | "pwd") is only used by the kiosk: the
// driver confirms it by tapping their NFC card. Logged-in passengers get their
// verified discount automatically on the server.
// The route, distance and fare come from a signed quote (see getQuote), never
// from the browser. origin / destination are the TERMINALS nearest to the
// pickup and drop-off points: they pick the queue the ride goes to.
// { origin, destination, quoteToken, source?, discountClaim? }
export const createRequest = ({
  origin,
  destination,
  quoteToken,
  source,
  discountClaim,
}) =>
  req("requests", {
    method: "POST",
    body: JSON.stringify({
      origin,
      destination,
      quoteToken,
      ...(source ? { source } : {}),
      ...(discountClaim ? { discountClaim } : {}),
    }),
  });

// Road distance and fare between two exact map points. pickup / dropoff are
// { lat, lng, label }. Returns { quoteToken, distanceMeters, estimated,
// geometry, regularFare, fare, discountType, discountApplied }.
export const getQuote = (pickup, dropoff) =>
  req("quote", {
    method: "POST",
    body: JSON.stringify({
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
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

// Passenger: the request plus the driver's live position while the driver is
// on the way. -> { request, driverLocation: { lat, lng, at } | null }
// Passenger: rate a completed ride (1-5 stars, optional comment). Once only.
export const rateRequest = (id, stars, comment) =>
  req(`requests?id=${encodeURIComponent(id)}&action=rate`, {
    method: "POST",
    body: JSON.stringify({ stars, comment }),
  });

export const trackRequest = (id) =>
  req(`requests?id=${encodeURIComponent(id)}&action=track`);

// Driver: reached the passenger (the passenger's screen switches to "on the
// way to the drop-off").
export const markPickedUp = (id) =>
  req(`requests?id=${encodeURIComponent(id)}&action=pickup`, {
    method: "POST",
  });

// Admin manual override: assign a waiting ride to a driver without an NFC tap.
export const overrideRequest = (id, driverId, reason) =>
  req(`requests?id=${encodeURIComponent(id)}&action=override`, {
    method: "POST",
    body: JSON.stringify({ driverId, reason }),
  });

export const cancelRequest = (id) =>
  req(`requests?id=${encodeURIComponent(id)}&action=cancel`, {
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
// Admin dashboard: user counts.
export const getUserStats = () => req("verifications?action=stats");
// Admin: every passenger account.
export const getPassengers = () => req("verifications?action=users");
// Admin: set how much temporary-access time one pending account has left.
export const setTimeLeft = (id, seconds) =>
  req(`verifications?id=${encodeURIComponent(id)}&action=timeleft`, {
    method: "POST",
    body: JSON.stringify({ seconds }),
  });
export const getVerificationPhotos = (id) =>
  req(`verifications?id=${encodeURIComponent(id)}`);
// decision: "approve" | "reject"
// reason: required when rejecting
// discountType: when approving - "student" | "senior" | "pwd" | "none"
export const reviewVerification = (id, decision, reason, discountType) =>
  req(`verifications?id=${encodeURIComponent(id)}&action=${decision}`, {
    method: "POST",
    body: JSON.stringify(
      decision === "reject" ? { reason } : discountType ? { discountType } : {},
    ),
  });

// -- SOS and incident reports ----------------------------------------------------------------
// data: { kind: "sos" | "incident", category?, description?, requestId?, lat?, lng? }
export const createReport = (data) =>
  req("reports?action=create", { method: "POST", body: JSON.stringify(data) });
// Admin
export const getReports = () => req("reports");
// Admin: unresolved SOS / incident alerts only (small, polled every ~3 s)
// Reporter: status of my own report -> { status, acknowledgedAt, acknowledgedNote, resolvedAt }
export const getReportStatus = (id) =>
  req(`reports?id=${encodeURIComponent(id)}&action=status`);
export const getAlerts = () => req("reports?action=alerts");
// action: "ack" | "resolve"
export const updateReport = (id, action, note) =>
  req(`reports?id=${encodeURIComponent(id)}&action=${action}`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });

// -- Kiosk staff (admin NFC card + PIN) and attendance ---------------------
// Kiosk: card tap + PIN -> short-lived token { token, name, expiresInSeconds }
export const staffLogin = (nfcId, pin) =>
  req("staff?action=login", {
    method: "POST",
    body: JSON.stringify({ nfcId, pin }),
  });
const staffReq = (token, path, options = {}) =>
  req(path, {
    ...options,
    headers: { "Content-Type": "application/json", "x-staff-token": token },
  });
export const staffDrivers = (token, terminal) =>
  staffReq(
    token,
    `staff?action=drivers&terminal=${encodeURIComponent(terminal)}`,
  );
export const staffAssign = (token, requestId, driverId) =>
  staffReq(token, "staff?action=assign", {
    method: "POST",
    body: JSON.stringify({ requestId, driverId }),
  });
export const staffCancel = (token, requestId) =>
  staffReq(token, "staff?action=cancel", {
    method: "POST",
    body: JSON.stringify({ requestId }),
  });
export const staffCheckin = (token, driverId, terminal) =>
  staffReq(token, "staff?action=checkin", {
    method: "POST",
    body: JSON.stringify({ driverId, terminal }),
  });
// Admin dashboard
export const getAttendance = (date) =>
  req(`staff?action=attendance${date ? `&date=${date}` : ""}`);
export const getStaffCards = () => req("staff?action=cards");
export const createStaffCard = (data) =>
  req("staff?action=card-create", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const updateStaffCard = (id, data) =>
  req(`staff?action=card-update&id=${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const deleteStaffCard = (id) =>
  req(`staff?action=card-delete&id=${encodeURIComponent(id)}`, {
    method: "POST",
  });

// -- Terminal line (queue) -------------------------------------------------
// Public: drivers in line + passengers waiting at a terminal
export const getQueue = (terminal) =>
  req(`queue?terminal=${encodeURIComponent(terminal)}`);
// Admin: every terminal's line
export const getAllQueues = () => req("queue?action=all");
// Driver: my place in line -> { terminal, position, lineLength } | null
export const getMyLine = () => req("queue?action=mine");
export const joinLine = (lat, lng) =>
  req("queue?action=join", {
    method: "POST",
    body: JSON.stringify({ lat, lng }),
  });
export const leaveLine = () => req("queue?action=leave", { method: "POST" });
// Staff panel: take a driver out of the line
export const staffRemoveFromLine = (token, driverId) =>
  staffReq(token, "staff?action=line-remove", {
    method: "POST",
    body: JSON.stringify({ driverId }),
  });
