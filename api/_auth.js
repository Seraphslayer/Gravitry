import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "gv_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signSession(payload) {
  if (!SECRET) throw new Error("Missing JWT_SECRET environment variable");
  return jwt.sign(payload, SECRET, { expiresIn: MAX_AGE_SECONDS });
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

export function setSessionCookie(res, token) {
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
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
