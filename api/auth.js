import { getDb } from "./_db.js";
import {
  comparePassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromReq,
} from "./_auth.js";

export default async function handler(req, res) {
  try {
    const { action } = req.query;

    if (req.method === "POST" && action === "login") {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "username and password are required" });
      }
      const db = await getDb();

      const admin = await db.collection("users").findOne({ username });
      if (
        admin?.passwordHash &&
        comparePassword(password, admin.passwordHash)
      ) {
        const token = signSession({
          sub: admin._id,
          role: "admin",
          name: admin.name || admin.username,
        });
        setSessionCookie(res, token);
        return res
          .status(200)
          .json({
            role: "admin",
            id: admin._id,
            name: admin.name || admin.username,
          });
      }

      const driver = await db.collection("drivers").findOne({ username });
      if (
        driver?.passwordHash &&
        comparePassword(password, driver.passwordHash)
      ) {
        const token = signSession({
          sub: driver._id,
          role: "driver",
          name: driver.name,
          driverId: driver._id,
        });
        setSessionCookie(res, token);
        return res
          .status(200)
          .json({
            role: "driver",
            id: driver._id,
            name: driver.name,
            driverId: driver._id,
          });
      }

      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (req.method === "POST" && action === "logout") {
      clearSessionCookie(res);
      return res.status(204).end();
    }

    if (req.method === "GET" && action === "me") {
      const session = getSessionFromReq(req);
      if (!session) return res.status(401).json({ error: "Not logged in" });
      return res.status(200).json({
        role: session.role,
        id: session.sub,
        name: session.name,
        driverId: session.driverId,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
}
