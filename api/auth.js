import { getDb } from "./_db.js";
import {
  hashPassword,
  comparePassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromReq,
} from "./_auth.js";

async function nextId(db, name, prefix) {
  const result = await db
    .collection("counters")
    .findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  const seq = result.value?.seq ?? result.seq ?? 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

export default async function handler(req, res) {
  try {
    const { action } = req.query;
    const db = await getDb();

    // POST /api/auth?action=signup — passenger self-service signup only
    if (req.method === "POST" && action === "signup") {
      const { username, password, name, phone } = req.body || {};
      if (!username || !password || !name) {
        return res
          .status(400)
          .json({ error: "username, password, and name are required" });
      }
      if (password.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters" });
      }
      const existing = await db.collection("passengers").findOne({ username });
      if (existing) {
        return res
          .status(409)
          .json({ error: "That username is already taken" });
      }
      const passengerId = await nextId(db, "passengers", "P");
      const doc = {
        _id: passengerId,
        username,
        name,
        phone: phone || null,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      await db.collection("passengers").insertOne(doc);
      const token = signSession({
        sub: passengerId,
        role: "passenger",
        name,
        passengerId,
      });
      setSessionCookie(res, token);
      return res
        .status(201)
        .json({ role: "passenger", id: passengerId, name, passengerId });
    }

    if (req.method === "POST" && action === "login") {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "username and password are required" });
      }

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

      const passenger = await db.collection("passengers").findOne({ username });
      if (
        passenger?.passwordHash &&
        comparePassword(password, passenger.passwordHash)
      ) {
        const token = signSession({
          sub: passenger._id,
          role: "passenger",
          name: passenger.name,
          passengerId: passenger._id,
        });
        setSessionCookie(res, token);
        return res
          .status(200)
          .json({
            role: "passenger",
            id: passenger._id,
            name: passenger.name,
            passengerId: passenger._id,
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
        passengerId: session.passengerId,
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
