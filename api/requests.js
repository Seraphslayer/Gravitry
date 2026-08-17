import { getDb } from "./_db.js";

async function nextId(db, name, prefix) {
  const result = await db.collection("counters").findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  const seq = result.value?.seq ?? result.seq ?? 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("requests");
    const { id, action, status, origin } = req.query;

    // POST /api/requests  — kiosk creates a pending ride request
    if (req.method === "POST" && !id) {
      const { origin: o, destination, fare } = req.body || {};
      if (!o || !destination || fare == null) {
        return res.status(400).json({ error: "origin, destination, fare are required" });
      }
      const reqId = await nextId(db, "requests", "DR");
      const doc = { _id: reqId, origin: o, destination, fare, status: "pending", ts: new Date().toISOString() };
      await col.insertOne(doc);
      return res.status(201).json(doc);
    }

    // GET /api/requests?status=pending&origin=T1  — list/filter
    if (req.method === "GET" && !id) {
      const filter = {};
      if (status) filter.status = status;
      if (origin) filter.origin = origin;
      const docs = await col.find(filter).sort({ ts: -1 }).toArray();
      return res.status(200).json(docs);
    }

    // GET /api/requests?id=DR-001  — single lookup
    if (req.method === "GET" && id && !action) {
      const doc = await col.findOne({ _id: id });
      if (!doc) return res.status(404).json({ error: "Request not found" });
      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=accept
    if (req.method === "POST" && id && action === "accept") {
      const { driverId } = req.body || {};
      if (!driverId) return res.status(400).json({ error: "driverId is required" });
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
        { returnDocument: "after" }
      );
      const doc = result.value ?? result;
      if (!doc) return res.status(409).json({ error: "Request already accepted or not found" });

      await db.collection("drivers").updateOne({ _id: driverId }, { $set: { status: "on_trip" } });
      await db.collection("tricycles").updateOne({ driverId }, { $set: { status: "on_trip", terminal: null } });

      return res.status(200).json(doc);
    }

    // POST /api/requests?id=DR-001&action=complete
    if (req.method === "POST" && id && action === "complete") {
      const result = await col.findOneAndUpdate(
        { _id: id },
        { $set: { status: "completed", completedAt: new Date().toISOString() } },
        { returnDocument: "after" }
      );
      const doc = result.value ?? result;
      if (!doc) return res.status(404).json({ error: "Request not found" });

      if (doc.driverId) {
        await db.collection("drivers").updateOne({ _id: doc.driverId }, { $set: { status: "available" } });
        await db.collection("tricycles").updateOne(
          { driverId: doc.driverId },
          { $set: { status: "available", terminal: doc.destination } }
        );
      }
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
