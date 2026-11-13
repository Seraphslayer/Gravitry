import { getSessionFromReq } from "./_auth.js";

// ---- Staff levels ------------------------------------------------------------
// TODA staff accounts live in the "users" collection and have a level:
//   admin        runs the system: dispatch, drivers, tricycles, tariff,
//                verification, incidents, reports
//   super_admin  everything, plus staff accounts and database export/backup
// A user document with NO level is an older account (made before levels
// existed); it keeps full power, i.e. super_admin.
//
// A login session carries role "admin" for both levels; `level` tells them apart.
export const STAFF_LEVELS = ["admin", "super_admin"];
export const levelOf = (user) => (user && user.level) || "super_admin";
const rank = (level) => STAFF_LEVELS.indexOf(level);

// Checks the request has a valid session, and (if allowedRoles is given) that
// the session's role is permitted. On failure, writes the 401/403 response
// itself and returns null - callers MUST `return` immediately when this
// returns null, or execution will continue as if authorized.
export function requireSession(req, res, allowedRoles = null) {
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    res.status(403).json({ error: "Not authorized for this action" });
    return null;
  }
  return session;
}

// Guards against NoSQL injection: MongoDB will accept an object like
// { "$ne": null } as a query value if it isn't checked first, which can
// bypass filters such as findOne({ username }). Always validate body/query
// values that flow into a Mongo filter are actually plain strings.
export function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
// Like requireSession, but for staff it also re-checks the account in the
// database: a disabled or deleted account is refused right away, and a changed
// level takes effect immediately instead of when the login expires.
// Sessions made before levels existed (no `level`) skip the database check;
// they expire within a day anyway. Use as: `await requireStaff(db, req, res, [...])`.
export async function requireStaff(db, req, res, allowedRoles = ["admin"]) {
  const session = requireSession(req, res, allowedRoles);
  if (!session) return null;
  if (session.role !== "admin") return session;
  if (!session.level) return session;
  const user = await db.collection("users").findOne({ _id: session.sub });
  if (!user || user.active === false) {
    res.status(401).json({ error: "This account is not active" });
    return null;
  }
  return { ...session, level: levelOf(user) };
}

// True only for a live, active staff account. For read endpoints that show
// more to staff (no 401 for everyone else): a disabled or deleted account's
// old cookie must not keep seeing staff-only data.
export async function isActiveStaff(db, req) {
  const s = getSessionFromReq(req);
  if (!s || s.role !== "admin") return false;
  if (!s.level) return true; // pre-level session, expires within a day
  const user = await db.collection("users").findOne({ _id: s.sub });
  return !!user && user.active !== false;
}

// Super admin only (staff accounts, database export). Always checked against
// the database, so it also works for older sessions.
export async function requireSuperAdmin(db, req, res) {
  const session = requireSession(req, res, ["admin"]);
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.sub });
  if (
    !user ||
    user.active === false ||
    rank(levelOf(user)) < rank("super_admin")
  ) {
    res.status(403).json({ error: "Only a super admin can do this" });
    return null;
  }
  return { ...session, level: "super_admin" };
}
