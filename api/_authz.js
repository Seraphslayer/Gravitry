import { getSessionFromReq } from "./_auth.js";

// ---- Staff levels ------------------------------------------------------------
// TODA staff accounts live in the "users" collection and have a level:
//   marshal      runs the terminal: dispatch, line, walk-up booking, incidents
//   admin        everything a marshal does, plus drivers, tricycles, tariff,
//                verification, reports
//   super_admin  everything, plus staff accounts and database export/backup
// A user document with NO level is an older account (made before levels
// existed); it keeps full power, i.e. super_admin.
//
// A login session carries role "admin" (admin + super admin) or "marshal".
// Endpoints that only list "admin" therefore refuse marshals by default; a
// marshal only gets in where an endpoint names "marshal" on purpose.
export const STAFF_LEVELS = ["marshal", "admin", "super_admin"];
export const levelOf = (user) => (user && user.level) || "super_admin";
export const roleForLevel = (level) =>
  level === "marshal" ? "marshal" : "admin";
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
  if (session.role !== "admin" && session.role !== "marshal") return session;
  if (!session.level) return session;
  const user = await db.collection("users").findOne({ _id: session.sub });
  if (!user || user.active === false) {
    res.status(401).json({ error: "This account is not active" });
    return null;
  }
  const level = levelOf(user);
  const role = roleForLevel(level);
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: "Not authorized for this action" });
    return null;
  }
  return { ...session, role, level };
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
