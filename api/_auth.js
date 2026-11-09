import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomInt } from "node:crypto";

const SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "gv_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// TODA staff (marshal / admin / super admin) stay signed in for one shift, not a
// week, so a disabled or demoted account loses access quickly.
export const STAFF_SESSION_SECONDS = 60 * 60 * 12;

export function signSession(payload, ttlSeconds = MAX_AGE_SECONDS) {
  if (!SECRET) throw new Error("Missing JWT_SECRET environment variable");
  return jwt.sign(payload, SECRET, { expiresIn: ttlSeconds });
}

export function verifySession(token) {
  if (!SECRET) throw new Error("Missing JWT_SECRET environment variable");
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(
      part.slice(idx + 1).trim(),
    );
  }
  return out;
}

export function setSessionCookie(res, token, maxAge = MAX_AGE_SECONDS) {
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function getSessionFromReq(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token);
}

// ---- Kiosk staff token ------------------------------------------------------
// After an admin taps their staff card at the kiosk and enters the PIN, the
// server hands the kiosk a short-lived token (sent in the x-staff-token header,
// never a cookie). It is signed with a different secret than login sessions, so
// neither kind of token can be used as the other.
const STAFF_TTL_SECONDS = 5 * 60;
export const STAFF_TOKEN_SECONDS = STAFF_TTL_SECONDS;

export function signStaffToken(payload) {
  if (!SECRET) throw new Error("Missing JWT_SECRET environment variable");
  return jwt.sign(
    { ...payload, kind: "kiosk-staff" },
    `${SECRET}:kiosk-staff`,
    {
      expiresIn: STAFF_TTL_SECONDS,
    },
  );
}

export function getStaffFromReq(req) {
  const token = req.headers["x-staff-token"];
  if (!token || typeof token !== "string" || !SECRET) return null;
  try {
    const p = jwt.verify(token, `${SECRET}:kiosk-staff`);
    return p?.kind === "kiosk-staff" ? p : null;
  } catch {
    return null;
  }
}

// Random password that satisfies the signup rules. Shown to the admin once.
export function generatePassword() {
  const pick = (chars) => chars[randomInt(chars.length)];
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digit = "23456789";
  const special = "!@#$%";
  const all = lower + upper + digit;
  const chars = [pick(lower), pick(upper), pick(digit), pick(special)];
  while (chars.length < 10) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
