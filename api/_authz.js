import { getSessionFromReq } from "./_auth.js";

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