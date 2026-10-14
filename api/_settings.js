// App-wide settings the admin can change (stored in the "settings" collection).
// Not a serverless function: files starting with "_" are just shared code.

// How long a new, not-yet-verified passenger account may keep booking rides.
// Stored in SECONDS so the admin can test very short windows (e.g. 10 s).
export const DEFAULT_TEMP_ACCESS_SECONDS = 5 * 60; // 5 minutes (test value)
export const MIN_TEMP_ACCESS_SECONDS = 5;
export const MAX_TEMP_ACCESS_SECONDS = 365 * 86400;

export async function getTempAccessSeconds(db) {
  const s = await db.collection("settings").findOne({ _id: "app" });
  const n = Number(s?.tempAccessSeconds);
  return Number.isFinite(n) &&
    n >= MIN_TEMP_ACCESS_SECONDS &&
    n <= MAX_TEMP_ACCESS_SECONDS
    ? Math.round(n)
    : DEFAULT_TEMP_ACCESS_SECONDS;
}

export const plusSeconds = (from, seconds) =>
  new Date(new Date(from).getTime() + seconds * 1000).toISOString();

// ISO time when a pending passenger's temporary access ends, or null for old
// records with no submit time. An admin extension (tempAccessUntil) wins over
// the default length, so changing the setting applies to everyone else at once.
export function tempAccessDeadline(passenger, seconds) {
  if (passenger.tempAccessUntil) return passenger.tempAccessUntil;
  const from = passenger.verificationSubmittedAt || passenger.createdAt;
  return from ? plusSeconds(from, seconds) : null;
}
