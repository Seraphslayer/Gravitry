// Rules for temporary (not yet verified) passenger accounts.
// Not a serverless function: files starting with "_" are just shared code.

// How long a new account may book rides while waiting for verification. This
// is only the starting value: the admin can set the time left on any single
// account from the Verify tab. 5 minutes is a TEST value.
export const TEMP_ACCESS_SECONDS = 5 * 60;
export const MAX_TEMP_ACCESS_SECONDS = 365 * 86400;

// ISO time when a pending passenger's temporary access ends, or null for old
// records with no submit time. An admin-set tempAccessUntil wins.
export function tempAccessDeadline(passenger) {
  if (passenger.tempAccessUntil) return passenger.tempAccessUntil;
  const from = passenger.verificationSubmittedAt || passenger.createdAt;
  return from
    ? new Date(
        new Date(from).getTime() + TEMP_ACCESS_SECONDS * 1000,
      ).toISOString()
    : null;
}
