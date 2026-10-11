import { getDb } from "./_db.js";
import {
  hashPassword,
  comparePassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromReq,
} from "./_auth.js";
import { isNonEmptyString, requireSession } from "./_authz.js";
import { isValidPhoto, withinRate } from "./_images.js";

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

// --- Basic brute-force protection ---
// Rate-limited per-username (not per-IP - Vercel doesn't reliably expose the
// real client IP without extra config, and per-username protection stops a
// distributed attack against one account regardless of source anyway).
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

async function checkLoginLock(db, username) {
  const key = `login:${username.toLowerCase()}`;
  const doc = await db.collection("login_attempts").findOne({ _id: key });
  if (doc?.lockUntil && new Date(doc.lockUntil) > new Date()) {
    return { locked: true, retryAt: doc.lockUntil };
  }
  return { locked: false, key };
}

async function recordLoginFailure(db, key) {
  const now = new Date();
  const doc = await db.collection("login_attempts").findOne({ _id: key });
  const count = (doc?.count || 0) + 1;
  const update = { count, lastAttempt: now };
  if (count >= MAX_ATTEMPTS) {
    update.lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60000);
    update.count = 0;
  }
  await db
    .collection("login_attempts")
    .updateOne({ _id: key }, { $set: update }, { upsert: true });
}

async function clearLoginFailures(db, key) {
  await db.collection("login_attempts").deleteOne({ _id: key });
}

export default async function handler(req, res) {
  try {
    const { action } = req.query;
    const db = await getDb();

    // POST /api/auth?action=signup - passenger self-service signup.
    // The account starts as "pending": the person must upload a government ID
    // photo and a selfie, and TODA staff verify them in the admin dashboard
    // before the account becomes permanent ("verified").
    if (req.method === "POST" && action === "signup") {
      const {
        username,
        password,
        name,
        phone,
        address,
        idPhoto,
        selfie,
        consent,
      } = req.body || {};
      if (
        !isNonEmptyString(username) ||
        !isNonEmptyString(password) ||
        !isNonEmptyString(name) ||
        !isNonEmptyString(address)
      ) {
        return res
          .status(400)
          .json({
            error: "username, password, name, and address are required",
          });
      }
      if (
        username.length > 40 ||
        name.length > 100 ||
        address.length > 200 ||
        password.length > 200
      ) {
        return res.status(400).json({ error: "One of the fields is too long" });
      }
      if (phone != null && typeof phone !== "string") {
        return res.status(400).json({ error: "Invalid phone value" });
      }
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      }
      if (consent !== true) {
        return res
          .status(400)
          .json({ error: "You must agree to the verification terms" });
      }
      if (!isValidPhoto(idPhoto) || !isValidPhoto(selfie)) {
        return res
          .status(400)
          .json({ error: "A government ID photo and a selfie are required" });
      }
      // Each signup stores two photos, so cap how fast accounts can be created
      // (protects the database from being filled by a script).
      if (!(await withinRate(db, "signup", 15, 10 * 60 * 1000))) {
        return res
          .status(429)
          .json({
            error: "Too many signups right now. Try again in a few minutes.",
          });
      }
      const existing = await db
        .collection("passengers")
        .findOne({ username: username.trim() });
      if (existing) {
        return res
          .status(409)
          .json({ error: "That username is already taken" });
      }
      const passengerId = await nextId(db, "passengers", "P");
      const nowIso = new Date().toISOString();
      const doc = {
        _id: passengerId,
        username: username.trim(),
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        address: address.trim(),
        passwordHash: hashPassword(password),
        status: "pending",
        verificationSubmittedAt: nowIso,
        consentAt: nowIso,
        createdAt: nowIso,
      };
      await db.collection("passengers").insertOne(doc);
      // Photos live in their own collection so no normal query on passengers
      // can ever return them.
      await db
        .collection("verifications")
        .updateOne(
          { _id: passengerId },
          { $set: { idPhoto, selfie, submittedAt: nowIso } },
          { upsert: true },
        );
      const token = signSession({
        sub: passengerId,
        role: "passenger",
        name: doc.name,
        passengerId,
      });
      setSessionCookie(res, token);
      return res.status(201).json({
        role: "passenger",
        id: passengerId,
        name: doc.name,
        passengerId,
        status: "pending",
      });
    }

    // POST /api/auth?action=resubmit - a passenger whose verification was
    // rejected (or who wants to replace their photos) sends new ones.
    if (req.method === "POST" && action === "resubmit") {
      const session = requireSession(req, res, ["passenger"]);
      if (!session) return;
      const { idPhoto, selfie, consent } = req.body || {};
      if (consent !== true) {
        return res
          .status(400)
          .json({ error: "You must agree to the verification terms" });
      }
      if (!isValidPhoto(idPhoto) || !isValidPhoto(selfie)) {
        return res
          .status(400)
          .json({ error: "A government ID photo and a selfie are required" });
      }
      if (!(await withinRate(db, "resubmit", 30, 10 * 60 * 1000))) {
        return res
          .status(429)
          .json({
            error: "Too many submissions right now. Try again shortly.",
          });
      }
      const p = await db
        .collection("passengers")
        .findOne({ _id: session.passengerId });
      if (!p) return res.status(404).json({ error: "Account not found" });
      if ((p.status || "verified") === "verified") {
        return res
          .status(409)
          .json({ error: "This account is already verified" });
      }
      const nowIso = new Date().toISOString();
      await db
        .collection("verifications")
        .updateOne(
          { _id: p._id },
          { $set: { idPhoto, selfie, submittedAt: nowIso } },
          { upsert: true },
        );
      await db.collection("passengers").updateOne(
        { _id: p._id },
        {
          $set: {
            status: "pending",
            verificationSubmittedAt: nowIso,
            consentAt: nowIso,
          },
          $unset: { rejectionReason: "" },
        },
      );
      return res.status(200).json({ status: "pending" });
    }

    if (req.method === "POST" && action === "login") {
      const { username, password } = req.body || {};
      if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
        return res
          .status(400)
          .json({ error: "username and password are required" });
      }
      const cleanUsername = username.trim();

      const { locked, retryAt, key } = await checkLoginLock(db, cleanUsername);
      if (locked) {
        return res.status(429).json({
          error: `Too many failed attempts. Try again after ${new Date(retryAt).toLocaleTimeString()}.`,
        });
      }

      const admin = await db
        .collection("users")
        .findOne({ username: cleanUsername });
      if (
        admin?.passwordHash &&
        comparePassword(password, admin.passwordHash)
      ) {
        await clearLoginFailures(db, key);
        const token = signSession({
          sub: admin._id,
          role: "admin",
          name: admin.name || admin.username,
        });
        setSessionCookie(res, token);
        return res.status(200).json({
          role: "admin",
          id: admin._id,
          name: admin.name || admin.username,
        });
      }

      const driver = await db
        .collection("drivers")
        .findOne({ username: cleanUsername });
      if (
        driver?.passwordHash &&
        comparePassword(password, driver.passwordHash)
      ) {
        await clearLoginFailures(db, key);
        const token = signSession({
          sub: driver._id,
          role: "driver",
          name: driver.name,
          driverId: driver._id,
        });
        setSessionCookie(res, token);
        return res.status(200).json({
          role: "driver",
          id: driver._id,
          name: driver.name,
          driverId: driver._id,
        });
      }

      const passenger = await db
        .collection("passengers")
        .findOne({ username: cleanUsername });
      if (
        passenger?.passwordHash &&
        comparePassword(password, passenger.passwordHash)
      ) {
        await clearLoginFailures(db, key);
        const token = signSession({
          sub: passenger._id,
          role: "passenger",
          name: passenger.name,
          passengerId: passenger._id,
        });
        setSessionCookie(res, token);
        return res.status(200).json({
          role: "passenger",
          id: passenger._id,
          name: passenger.name,
          passengerId: passenger._id,
          status: passenger.status || "verified",
          rejectionReason: passenger.rejectionReason || null,
        });
      }

      await recordLoginFailure(db, key);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (req.method === "POST" && action === "logout") {
      clearSessionCookie(res);
      return res.status(204).end();
    }

    if (req.method === "GET" && action === "me") {
      const session = getSessionFromReq(req);
      if (!session) return res.status(401).json({ error: "Not logged in" });
      let passengerInfo = {};
      if (session.role === "passenger") {
        const p = await db
          .collection("passengers")
          .findOne(
            { _id: session.passengerId },
            { projection: { status: 1, rejectionReason: 1 } },
          );
        if (!p) {
          clearSessionCookie(res);
          return res.status(401).json({ error: "Account not found" });
        }
        passengerInfo = {
          status: p.status || "verified",
          rejectionReason: p.rejectionReason || null,
        };
      }
      return res.status(200).json({
        ...passengerInfo,
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
    return res.status(500).json({ error: "Internal server error" });
  }
}
