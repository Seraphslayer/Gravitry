import { getDb } from "./_db.js";
import {
  getSessionFromReq,
  getStaffFromReq,
  signStaffToken,
  STAFF_TOKEN_SECONDS,
  hashPassword,
  comparePassword,
} from "./_auth.js";
import { requireSession, isNonEmptyString } from "./_authz.js";
import {
  expiredDocsOf,
  recordAttendance,
  assignRide,
  cancelPending,
  joinLine,
  leaveLine,
  phDate,
} from "./_dispatch.js";

// Admin staff cards for the kiosk + driver attendance.
//
//   POST /api/staff?action=login            { nfcId, pin }         kiosk -> { token }
//   GET  /api/staff?action=drivers&terminal=T1      staff token or admin
//   POST /api/staff?action=assign           { requestId, driverId } staff token or admin
//   POST /api/staff?action=cancel           { requestId }           staff token or admin
//   POST /api/staff?action=checkin          { driverId, terminal }  staff token or admin
//   POST /api/staff?action=line-remove      { driverId }            staff token or admin
//   POST /api/staff?action=line-remove      { driverId }            staff token or admin
//   GET  /api/staff?action=attendance&date=YYYY-MM-DD               admin
//   GET  /api/staff?action=cards                                    admin
//   POST /api/staff?action=card-create      { name, nfcId, pin }    admin
//   POST /api/staff?action=card-update&id=  { pin?, active? }       admin
//   POST /api/staff?action=card-delete&id=                          admin

const NFC_RE = /^[0-9]{6,20}$/;
const PIN_RE = /^[0-9]{4,8}$/;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MIN = 15;

// Who is calling? A kiosk staff token (card + PIN) or a logged-in admin.
function getActor(req, res) {
  const staff = getStaffFromReq(req);
  if (staff) return { by: `staff:${staff.name}`, name: staff.name };
  const session = getSessionFromReq(req);
  if (session?.role === "admin")
    return { by: session.sub || "admin", name: "Admin" };
  res.status(401).json({ error: "Staff sign-in required" });
  return null;
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const { action, id } = req.query;
    const body = req.body || {};

    // ---- kiosk: staff card + PIN -> short-lived token ---------------------
    if (req.method === "POST" && action === "login") {
      const { nfcId, pin } = body;
      if (!NFC_RE.test(String(nfcId || "")) || !PIN_RE.test(String(pin || "")))
        return res.status(400).json({ error: "Invalid card or PIN" });

      const att = db.collection("staff_attempts");
      const rec = await att.findOne({ _id: nfcId });
      if (rec?.lockUntil && new Date(rec.lockUntil) > new Date())
        return res.status(429).json({
          error: "Too many wrong PINs. This card is locked for a while.",
        });

      const card = await db.collection("staff_cards").findOne({ _id: nfcId });
      const ok =
        !!card && card.active && comparePassword(String(pin), card.pinHash);
      if (!ok) {
        const count = (rec?.count || 0) + 1;
        const set = { count, last: new Date() };
        if (count >= LOGIN_MAX_FAILS) {
          set.lockUntil = new Date(Date.now() + LOGIN_LOCK_MIN * 60000);
          set.count = 0;
        }
        await att.updateOne({ _id: nfcId }, { $set: set }, { upsert: true });
        return res.status(401).json({ error: "Wrong PIN" });
      }
      await att.updateOne(
        { _id: nfcId },
        { $set: { count: 0 }, $unset: { lockUntil: "" } },
      );
      const token = signStaffToken({ staffId: card._id, name: card.name });
      return res.status(200).json({
        token,
        name: card.name,
        expiresInSeconds: STAFF_TOKEN_SECONDS,
      });
    }

    // ---- staff panel actions ----------------------------------------------
    if (req.method === "GET" && action === "drivers") {
      const actor = getActor(req, res);
      if (!actor) return;
      const terminal = isNonEmptyString(req.query.terminal)
        ? req.query.terminal
        : "T1";
      const drivers = await db.collection("drivers").find({}).toArray();
      const present = await db
        .collection("attendance")
        .find({ date: phDate(), terminal })
        .toArray();
      const presentIds = new Set(present.map((a) => a.driverId));
      return res.status(200).json(
        drivers.map((d) => {
          const expired = expiredDocsOf(d);
          return {
            id: d._id,
            name: d.name,
            unit: d.unit || null,
            onTrip: d.status === "on_trip",
            expired,
            eligible: d.status !== "on_trip" && expired.length === 0,
            checkedIn: presentIds.has(d._id),
          };
        }),
      );
    }

    if (req.method === "POST" && action === "assign") {
      const actor = getActor(req, res);
      if (!actor) return;
      if (!isNonEmptyString(body.requestId) || !isNonEmptyString(body.driverId))
        return res.status(400).json({ error: "Choose a ride and a driver" });
      const out = await assignRide(db, {
        id: body.requestId,
        driverId: body.driverId,
        reason: `Assigned by ${actor.name} at the kiosk`,
        by: actor.by,
      });
      return res.status(out.code).json(out.body);
    }

    if (req.method === "POST" && action === "cancel") {
      const actor = getActor(req, res);
      if (!actor) return;
      if (!isNonEmptyString(body.requestId))
        return res.status(400).json({ error: "Choose a ride" });
      const out = await cancelPending(db, body.requestId);
      return res.status(out.code).json(out.body);
    }

    if (req.method === "POST" && action === "checkin") {
      const actor = getActor(req, res);
      if (!actor) return;
      if (!isNonEmptyString(body.driverId))
        return res.status(400).json({ error: "Choose a driver" });
      const terminal = isNonEmptyString(body.terminal) ? body.terminal : "T1";
      const driver = await db
        .collection("drivers")
        .findOne({ _id: body.driverId });
      if (!driver) return res.status(404).json({ error: "Driver not found" });
      const expired = expiredDocsOf(driver);
      if (expired.length)
        return res.status(403).json({
          error: `${driver.name}'s ${expired.join(" and ")} has expired, so they cannot be checked in.`,
        });
      const out = await recordAttendance(
        db,
        driver,
        terminal,
        "manual",
        actor.by,
      );
      // Checked in by staff = also in the terminal's line.
      await joinLine(db, driver, terminal, "manual");
      return res.status(200).json({ ok: true, first: out.first });
    }

    // Staff take a driver out of the terminal line (left without taking a ride).
    if (req.method === "POST" && action === "line-remove") {
      const actor = getActor(req, res);
      if (!actor) return;
      if (!isNonEmptyString(body.driverId))
        return res.status(400).json({ error: "Choose a driver" });
      await leaveLine(db, body.driverId);
      return res.status(200).json({ ok: true });
    }

    // ---- admin only --------------------------------------------------------
    if (req.method === "GET" && action === "attendance") {
      if (!requireSession(req, res, ["admin"])) return;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")
        ? req.query.date
        : phDate();
      const rows = await db.collection("attendance").find({ date }).toArray();
      rows.sort((a, b) => (a.firstTapAt < b.firstTapAt ? -1 : 1));
      return res.status(200).json({ date, rows });
    }

    if (req.method === "GET" && action === "cards") {
      if (!requireSession(req, res, ["admin"])) return;
      const cards = await db.collection("staff_cards").find({}).toArray();
      return res.status(200).json(
        cards.map((c) => ({
          id: c._id,
          name: c.name,
          // only the last 4 digits are shown back
          cardEnd: c._id.slice(-4),
          active: c.active,
          createdAt: c.createdAt,
        })),
      );
    }

    if (req.method === "POST" && action === "card-create") {
      if (!requireSession(req, res, ["admin"])) return;
      const name =
        typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      const nfcId = String(body.nfcId || "").trim();
      const pin = String(body.pin || "");
      if (name.length < 2)
        return res.status(400).json({ error: "Enter a name" });
      if (!NFC_RE.test(nfcId))
        return res
          .status(400)
          .json({ error: "Card number must be 6-20 digits" });
      if (!PIN_RE.test(pin))
        return res.status(400).json({ error: "PIN must be 4-8 digits" });
      if (await db.collection("drivers").findOne({ nfcId }))
        return res.status(409).json({ error: "That card belongs to a driver" });
      if (await db.collection("staff_cards").findOne({ _id: nfcId }))
        return res
          .status(409)
          .json({ error: "That card is already registered" });
      await db.collection("staff_cards").insertOne({
        _id: nfcId,
        name,
        pinHash: hashPassword(pin),
        active: true,
        createdAt: new Date().toISOString(),
      });
      return res.status(201).json({ id: nfcId, name });
    }

    if (req.method === "POST" && action === "card-update" && id) {
      if (!requireSession(req, res, ["admin"])) return;
      const set = {};
      if (body.pin !== undefined) {
        if (!PIN_RE.test(String(body.pin)))
          return res.status(400).json({ error: "PIN must be 4-8 digits" });
        set.pinHash = hashPassword(String(body.pin));
      }
      if (typeof body.active === "boolean") set.active = body.active;
      if (!Object.keys(set).length)
        return res.status(400).json({ error: "Nothing to change" });
      if (!(await db.collection("staff_cards").findOne({ _id: id })))
        return res.status(404).json({ error: "Card not found" });
      await db.collection("staff_cards").updateOne({ _id: id }, { $set: set });
      // a reset PIN also clears any lockout
      await db
        .collection("staff_attempts")
        .updateOne(
          { _id: id },
          { $set: { count: 0 }, $unset: { lockUntil: "" } },
        );
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && action === "card-delete" && id) {
      if (!requireSession(req, res, ["admin"])) return;
      await db.collection("staff_cards").deleteOne({ _id: id });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("staff api error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
