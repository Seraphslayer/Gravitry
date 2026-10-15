import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString } from "./_authz.js";
import { withinRate } from "./_images.js";

// SOS alerts and incident reports.
//
//   POST /api/reports?action=create   passenger or driver
//        { kind: "sos" | "incident", category?, description?, requestId?, lat?, lng? }
//   GET  /api/reports                 admin: all reports, newest first
//   POST /api/reports?id=IR-001&action=ack | resolve   admin  { note? }
//
// An SOS is one tap: it only needs the person (from the session) and, if the
// phone can give it, their location. An incident report needs a category and a
// short description. Either may be attached to a ride (requestId), but only a
// ride the reporter was really part of.

const CATEGORIES = {
  passenger: {
    reckless_driving: "Reckless driving",
    overcharging: "Overcharging / wrong fare",
    rude_behavior: "Rude or unsafe behavior",
    harassment: "Harassment",
    accident: "Accident",
    lost_item: "Lost item",
    other: "Other",
  },
  driver: {
    rude_passenger: "Rude or unsafe passenger",
    refused_to_pay: "Refused to pay",
    harassment: "Harassment",
    accident: "Accident",
    vehicle_problem: "Vehicle problem",
    other: "Other",
  },
};

async function nextId(db, name, prefix) {
  const result = await db
    .collection("counters")
    .findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  const seq = result?.value?.seq ?? result?.seq ?? 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

const validPoint = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= 4 &&
  lat <= 22 &&
  lng >= 116 &&
  lng <= 128;

export default async function handler(req, res) {
  try {
    const { id, action } = req.query;
    const db = await getDb();
    const col = db.collection("reports");

    // ---- create (passenger / driver) --------------------------------------
    if (req.method === "POST" && action === "create") {
      const session = requireSession(req, res, ["passenger", "driver"]);
      if (!session) return;
      const role = session.role;
      const userId = role === "driver" ? session.driverId : session.passengerId;

      const body = req.body || {};
      const kind =
        body.kind === "sos"
          ? "sos"
          : body.kind === "incident"
            ? "incident"
            : null;
      if (!kind) return res.status(400).json({ error: "Invalid report type" });

      let category = "emergency";
      let description = "";
      if (body.description != null && typeof body.description !== "string")
        return res.status(400).json({ error: "Invalid description" });
      description = (body.description || "").trim().slice(0, 600);
      if (kind === "incident") {
        category = body.category;
        if (typeof category !== "string" || !CATEGORIES[role][category])
          return res.status(400).json({ error: "Please choose what happened" });
        if (description.length < 5)
          return res
            .status(400)
            .json({ error: "Please describe what happened (a few words)" });
      }

      // Stops a script or a stuck finger from flooding the admin screen.
      if (
        !(await withinRate(db, `report:${role}:${userId}`, 6, 10 * 60 * 1000))
      ) {
        return res
          .status(429)
          .json({ error: "Too many reports. If you are in danger, call 911." });
      }

      // Reporter details come from the database, never from the request.
      let reporter;
      if (role === "driver") {
        const d = await db
          .collection("drivers")
          .findOne(
            { _id: userId },
            { projection: { name: 1, contact: 1, unit: 1, plate: 1 } },
          );
        reporter = {
          role,
          id: userId,
          name: d?.name || session.name,
          phone: d?.contact || null,
          unit: d?.unit || null,
          plate: d?.plate || null,
        };
      } else {
        const p = await db
          .collection("passengers")
          .findOne({ _id: userId }, { projection: { name: 1, phone: 1 } });
        reporter = {
          role,
          id: userId,
          name: p?.name || session.name,
          phone: p?.phone || null,
        };
      }

      // Optional ride: must be the reporter's own.
      let ride = null;
      if (isNonEmptyString(body.requestId)) {
        const r = await db
          .collection("requests")
          .findOne({ _id: body.requestId });
        const mine =
          r &&
          (role === "driver"
            ? r.driverId === userId
            : r.passengerId === userId);
        if (mine) {
          ride = {
            id: r._id,
            status: r.status,
            driver: r.driver || null,
            driverId: r.driverId || null,
            unit: r.unit || null,
            plate: r.plate || null,
            passengerName: r.passengerName || null,
            passengerId: r.passengerId || null,
            pickup: r.pickup?.label || null,
            dropoff: r.dropoff?.label || null,
          };
        }
      }

      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const location = validPoint(lat, lng)
        ? { lat, lng, at: new Date().toISOString() }
        : null;

      const doc = {
        _id: await nextId(db, "reports", "IR"),
        kind,
        category,
        categoryLabel:
          kind === "sos" ? "Emergency SOS" : CATEGORIES[role][category],
        description,
        reporter,
        ride,
        location,
        status: "open",
        ts: new Date().toISOString(),
      };
      await col.insertOne(doc);
      return res.status(201).json({ id: doc._id, kind, ts: doc.ts });
    }

    // ---- admin: list ---------------------------------------------------------
    if (req.method === "GET" && !id) {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const docs = await col.find({}).sort({ ts: -1 }).toArray();
      return res.status(200).json(docs);
    }

    // ---- admin: acknowledge / resolve -----------------------------------
    if (
      req.method === "POST" &&
      id &&
      (action === "ack" || action === "resolve")
    ) {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const note =
        typeof req.body?.note === "string"
          ? req.body.note.trim().slice(0, 400)
          : "";
      const nowIso = new Date().toISOString();
      const set =
        action === "ack"
          ? {
              status: "acknowledged",
              acknowledgedAt: nowIso,
              acknowledgedBy: session.sub,
            }
          : {
              status: "resolved",
              resolvedAt: nowIso,
              resolvedBy: session.sub,
              resolutionNote: note,
            };
      const existing = await col.findOne({ _id: id });
      if (!existing) return res.status(404).json({ error: "Report not found" });
      if (existing.status === "resolved")
        return res.status(409).json({ error: "Already resolved" });
      await col.updateOne({ _id: id }, { $set: set });
      return res.status(200).json({ ...existing, ...set });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
