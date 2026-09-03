import { getDb } from "./_db.js";
import { getSessionFromReq } from "./_auth.js";
import { requireSession, isNonEmptyString } from "./_authz.js";

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
    const db = await getDb();
    const col = db.collection("requests");
    const { id, action, status, origin, passengerId } = req.query;

    // POST /api/requests  — kiosk or passenger app creates a pending ride request
    if (req.method === "POST" && !id) {
      const { origin: o, destination, fare } = req.body || {};
      if (!isNonEmptyString(o) || !isNonEmptyString(destination)) {
        return res
          .status(400)
          .json({ error: "origin and destination are required" });
      }
      if (typeof fare !== "number" || !Number.isFinite(fare) || fare < 0) {
        return res
          .status(400)
          .json({ error: "fare must be a non-negative number" });
      }

      // Passenger identity is derived from the session, never trusted from the
      // request body — otherwise anyone could tag a ride with someone else's
      // passengerId and pollute their ride history. Guests (no session) simply
      // get no passenger fields, same as before.
      const session = getSessionFromReq(req);
      const identity =
        session?.role === "passenger"
          ? { passengerId: session.passengerId, passengerName: session.name }
          : {};

      const reqId = await nextId(db, "requests", "DR");
      const doc = {
        _id: reqId,
        origin: o,
        destination,
        fare,
        status: "pending",
        ts: new Date().toISOString(),
        ...identity,
      };
      await col.insertOne(doc);
      return res.status(201).json(doc);
    }

    // GET /api/requests?status=pending&origin=T1&passengerId=P-001  — list/filter
    if (req.method === "GET" && !id) {
      const filter = {};
      if (status) filter.status = status;
      if (origin) filter.origin = origin;

      if (passengerId) {
        // Ride history is private — only the passenger themself or an admin
        // may read it. Without this, sequential passenger IDs (P-001, P-002…)
        // would let anyone browse anyone else's trip history.
        const session = requireSession(req, res);
        if (!session) return;
        if (session.role !== "admin" && session.passengerId !== passengerId) {
          return res
            .status(403)
            .json({ error: "Not authorized to view this ride history" });
        }
        filter.passengerId = passengerId;
      }

      const docs = await col.find(filter).sort({ ts: -1 }).toArray();
      return res.status(200).json(docs);
    }

    // GET /api/requests?id=DR-001  — single lookup (used by kiosk/passenger
    // waiting screens; intentionally public since the requester may not be
    // logged in, and the safety-record contents are meant to be shown here)
    if (req.method === "GET" && id && !action) {
      const doc = await col.findOne({ _id: id });
      if (!doc) return res.status(404).json({ error: "Request not found" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=accept
    if (req.method === "POST" && id && action === "accept") {
      // Only an authenticated driver can accept, and only as themself — the
      // driverId always comes from the session, never the request body, so
      // one driver can't accept a trip "as" another driver.
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const driverId = session.driverId;

      const driver = await db.collection("drivers").findOne({ _id: driverId });
      if (!driver) return res.status(404).json({ error: "Driver not found" });

      const update = {
        status: "dispatched",
        driver: driver.name,
        driverId: driver._id,
        unit: driver.unit,
        plate: driver.plate || "N/A",
        acceptedAt: new Date().toISOString(),
      };
      const result = await col.findOneAndUpdate(
        { _id: id, status: "pending" },
        { $set: update },
        { returnDocument: "after" },
      );
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(409)
          .json({ error: "Request already accepted or not found" });

      await db
        .collection("drivers")
        .updateOne({ _id: driverId }, { $set: { status: "on_trip" } });
      await db
        .collection("tricycles")
        .updateOne(
          { driverId },
          { $set: { status: "on_trip", terminal: null } },
        );

      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=complete
    if (req.method === "POST" && id && action === "complete") {
      // Only the driver who accepted this specific trip (or an admin) may
      // mark it complete — otherwise any caller could free up a tricycle
      // mid-trip or tamper with another driver's dispatch record.
      const session = requireSession(req, res, ["driver", "admin"]);
      if (!session) return;

      const filter =
        session.role === "admin"
          ? { _id: id }
          : { _id: id, driverId: session.driverId };
      const result = await col.findOneAndUpdate(
        filter,
        {
          $set: { status: "completed", completedAt: new Date().toISOString() },
        },
        { returnDocument: "after" },
      );
      const doc = result.value ?? result;
      if (!doc)
        return res
          .status(404)
          .json({ error: "Request not found, or not assigned to you" });

      if (doc.driverId) {
        await db
          .collection("drivers")
          .updateOne({ _id: doc.driverId }, { $set: { status: "available" } });
        await db
          .collection("tricycles")
          .updateOne(
            { driverId: doc.driverId },
            { $set: { status: "available", terminal: doc.destination } },
          );
      }
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
