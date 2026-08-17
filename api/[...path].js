import { getDb } from "./_db.js";

// ── ID generation (simple incrementing counters, e.g. DR-001) ───────────────
async function nextId(db, name, prefix) {
  const res = await db
    .collection("counters")
    .findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  const seq = res.value?.seq ?? res.seq ?? 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

function sendJson(res, status, data) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .end(JSON.stringify(data));
}
function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body; // Vercel auto-parses JSON
  return {};
}

export default async function handler(req, res) {
  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path].filter(Boolean);
  const [resource, id, action] = segments;

  try {
    const db = await getDb();

    // ── /api/fares ──────────────────────────────────────────────────────
    if (resource === "fares") {
      if (req.method === "GET") {
        const docs = await db.collection("fares").find({}).toArray();
        const map = {};
        for (const d of docs) map[d._id] = d.fare;
        return sendJson(res, 200, map);
      }
      if (req.method === "PATCH") {
        const { origin, destination, fare } = await readBody(req);
        if (!origin || !destination || !fare)
          return sendError(res, 400, "origin, destination, fare are required");
        const key = `${origin}-${destination}`;
        await db.collection("fares").updateOne(
          { _id: key },
          {
            $set: { origin, destination, fare, updatedAt: new Date() },
            $push: { history: { fare, changedAt: new Date() } },
          },
          { upsert: true },
        );
        return sendJson(res, 200, { key, fare });
      }
      return sendError(res, 405, "Method not allowed");
    }

    // ── /api/drivers ────────────────────────────────────────────────────
    if (resource === "drivers") {
      if (req.method === "GET" && !id) {
        const docs = await db.collection("drivers").find({}).toArray();
        return sendJson(res, 200, docs);
      }
      if (req.method === "PATCH" && id) {
        const patch = await readBody(req);
        delete patch._id;
        await db.collection("drivers").updateOne({ _id: id }, { $set: patch });
        const doc = await db.collection("drivers").findOne({ _id: id });
        return sendJson(res, 200, doc);
      }
      return sendError(res, 405, "Method not allowed");
    }

    // ── /api/tricycles ──────────────────────────────────────────────────
    if (resource === "tricycles") {
      if (req.method === "GET") {
        const docs = await db.collection("tricycles").find({}).toArray();
        return sendJson(res, 200, docs);
      }
      return sendError(res, 405, "Method not allowed");
    }

    // ── /api/requests ───────────────────────────────────────────────────
    if (resource === "requests") {
      const col = db.collection("requests");

      // POST /api/requests  — kiosk creates a pending ride request
      if (req.method === "POST" && !id) {
        const { origin, destination, fare } = await readBody(req);
        if (!origin || !destination || fare == null)
          return sendError(res, 400, "origin, destination, fare are required");
        const reqId = await nextId(db, "requests", "DR");
        const doc = {
          _id: reqId,
          origin,
          destination,
          fare,
          status: "pending",
          ts: new Date().toISOString(),
        };
        await col.insertOne(doc);
        return sendJson(res, 201, doc);
      }

      // GET /api/requests?status=pending&origin=T1  — list/filter
      if (req.method === "GET" && !id) {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.origin) filter.origin = req.query.origin;
        const docs = await col.find(filter).sort({ ts: -1 }).toArray();
        return sendJson(res, 200, docs);
      }

      // GET /api/requests/:id  — single lookup (kiosk polls its own request)
      if (req.method === "GET" && id && !action) {
        const doc = await col.findOne({ _id: id });
        if (!doc) return sendError(res, 404, "Request not found");
        return sendJson(res, 200, doc);
      }

      // POST /api/requests/:id/accept  — driver accepts a pending request
      if (req.method === "POST" && id && action === "accept") {
        const { driverId } = await readBody(req);
        if (!driverId) return sendError(res, 400, "driverId is required");
        const driver = await db
          .collection("drivers")
          .findOne({ _id: driverId });
        if (!driver) return sendError(res, 404, "Driver not found");

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
          return sendError(res, 409, "Request already accepted or not found");

        await db
          .collection("drivers")
          .updateOne({ _id: driverId }, { $set: { status: "on_trip" } });
        await db
          .collection("tricycles")
          .updateOne(
            { driverId },
            { $set: { status: "on_trip", terminal: null } },
          );

        return sendJson(res, 200, doc);
      }

      // POST /api/requests/:id/complete  — driver marks trip done
      if (req.method === "POST" && id && action === "complete") {
        const result = await col.findOneAndUpdate(
          { _id: id },
          {
            $set: {
              status: "completed",
              completedAt: new Date().toISOString(),
            },
          },
          { returnDocument: "after" },
        );
        const doc = result.value ?? result;
        if (!doc) return sendError(res, 404, "Request not found");

        if (doc.driverId) {
          await db
            .collection("drivers")
            .updateOne(
              { _id: doc.driverId },
              { $set: { status: "available" } },
            );
          await db
            .collection("tricycles")
            .updateOne(
              { driverId: doc.driverId },
              { $set: { status: "available", terminal: doc.destination } },
            );
        }
        return sendJson(res, 200, doc);
      }

      return sendError(res, 405, "Method not allowed");
    }

    return sendError(res, 404, "Unknown resource");
  } catch (err) {
    console.error(err);
    return sendError(res, 500, err.message || "Internal server error");
  }
}
