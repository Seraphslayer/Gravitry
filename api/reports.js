import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString, requireStaff } from "./_authz.js";
import { withinRate } from "./_images.js";
import { notify, msg } from "./_push.js";

// SOS alerts and incident reports.
//
//   POST /api/reports?action=create   passenger or driver
//        { kind: "sos" | "incident", category?, description?, requestId?, lat?, lng? }
//   GET  /api/reports                 admin: all reports, newest first
//   GET  /api/reports?action=staff    admin: active staff, for "assign to"
//   POST /api/reports?id=IR-001&action=...   admin
//        ack                       { note? }  "we got it"
//        assign                    { userId? } take it yourself, or give it to a staff member
//        note                      { note }   a progress update in the timeline
//        resolve                   { outcome?, note? }  outcome: resolved | false_alarm | referred | no_action
//        reopen (admin only)       { note }   a resolved report that needs more work
// Every step is kept in `timeline` (who, when, what), so the report can be
// reviewed later. An SOS nobody has answered for SOS_OVERDUE_MIN is `overdue`.
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

const OUTCOMES = {
  resolved: "Resolved",
  false_alarm: "False alarm",
  referred: "Referred to police / barangay / hospital",
  no_action: "No action needed",
};
const SOS_OVERDUE_MIN = 3;

const asPerson = (session) => ({
  id: session.sub,
  name: session.name || "Staff",
  level: session.level || null,
});

// The history of a report. Reports made before timelines existed get one built
// from their old fields.
function timelineOf(doc) {
  if (Array.isArray(doc.timeline) && doc.timeline.length) return doc.timeline;
  const out = [
    {
      type: "created",
      at: doc.ts,
      by: { name: doc.reporter?.name || "Reporter" },
    },
  ];
  if (doc.acknowledgedAt)
    out.push({
      type: "acknowledged",
      at: doc.acknowledgedAt,
      by: { id: doc.acknowledgedBy },
      note: doc.acknowledgedNote || "",
    });
  if (doc.resolvedAt)
    out.push({
      type: "resolved",
      at: doc.resolvedAt,
      by: { id: doc.resolvedBy },
      note: doc.resolutionNote || "",
    });
  return out;
}

const isOverdue = (doc) =>
  doc.kind === "sos" &&
  doc.status === "open" &&
  Date.now() - new Date(doc.ts).getTime() > SOS_OVERDUE_MIN * 60000;

const present = (doc) => ({
  ...doc,
  timeline: timelineOf(doc),
  overdue: isOverdue(doc),
});

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
        timeline: [
          {
            type: "created",
            at: new Date().toISOString(),
            by: { name: reporter?.name || "Reporter" },
          },
        ],
      };
      await col.insertOne(doc);
      // TODA staff get it on their phones even if the admin page is closed.
      await notify(db, { role: "admin" }, msg.sos(doc));
      return res.status(201).json({ id: doc._id, kind, ts: doc.ts });
    }

    // ---- reporter: status of my own report (the SOS screen polls this so the
    // person can see that staff received it / are on the way) ----------------
    if (req.method === "GET" && id && action === "status") {
      const session = requireSession(req, res, ["passenger", "driver"]);
      if (!session) return;
      const mineId =
        session.role === "driver" ? session.driverId : session.passengerId;
      const doc = await col.findOne({ _id: id });
      if (
        !doc ||
        doc.reporter?.role !== session.role ||
        doc.reporter?.id !== mineId
      )
        return res.status(404).json({ error: "Report not found" });
      return res.status(200).json({
        status: doc.status,
        acknowledgedAt: doc.acknowledgedAt || null,
        acknowledgedNote: doc.acknowledgedNote || null,
        resolvedAt: doc.resolvedAt || null,
        resolutionNote:
          doc.status === "resolved" ? doc.resolutionNote || null : null,
        outcome: doc.status === "resolved" ? doc.outcome || null : null,
        assignedTo: doc.assignedTo?.name || null,
      });
    }

    // ---- admin: unresolved alerts only (polled every few seconds) ------------
    // Small on purpose: just what the SOS banner needs, so the admin page can
    // ask for it often without loading the whole report history.
    if (req.method === "GET" && action === "alerts") {
      const session = await requireStaff(db, req, res, ["admin"]);
      if (!session) return;
      const docs = await col
        .find({ status: { $in: ["open", "acknowledged"] } })
        .sort({ ts: -1 })
        .toArray();
      return res.status(200).json(
        docs.slice(0, 50).map((d) => ({
          _id: d._id,
          kind: d.kind,
          categoryLabel: d.categoryLabel,
          status: d.status,
          overdue: isOverdue(d),
          assignedTo: d.assignedTo?.name || null,
          ts: d.ts,
          reporter: d.reporter
            ? {
                role: d.reporter.role,
                name: d.reporter.name,
                phone: d.reporter.phone,
                unit: d.reporter.unit,
              }
            : null,
          hasLocation: !!d.location,
        })),
      );
    }

    // ---- staff list for "assign to" -------------------------------------------
    if (req.method === "GET" && action === "staff") {
      const session = await requireStaff(db, req, res, ["admin"]);
      if (!session) return;
      const users = await db.collection("users").find({}).toArray();
      return res.status(200).json(
        users
          .filter((u) => u.active !== false)
          .map((u) => ({ id: u._id, name: u.name || u.username }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      );
    }

    // ---- admin: list ---------------------------------------------------------
    if (req.method === "GET" && !id) {
      const session = await requireStaff(db, req, res, ["admin"]);
      if (!session) return;
      const docs = await col.find({}).sort({ ts: -1 }).toArray();
      return res.status(200).json(docs.map(present));
    }

    // ---- staff: work a report (ack / assign / note / resolve / reopen) ----------
    if (
      req.method === "POST" &&
      id &&
      ["ack", "assign", "note", "resolve", "reopen"].includes(action)
    ) {
      const session = await requireStaff(db, req, res, ["admin"]);
      if (!session) return;
      const note =
        typeof req.body?.note === "string"
          ? req.body.note.trim().slice(0, 400)
          : "";
      const nowIso = new Date().toISOString();
      const me = asPerson(session);
      const existing = await col.findOne({ _id: id });
      if (!existing) return res.status(404).json({ error: "Report not found" });
      const history = timelineOf(existing);
      const event = (type, extra = {}) => ({
        type,
        at: nowIso,
        by: me,
        ...(note ? { note } : {}),
        ...extra,
      });
      const set = {};
      const unset = {};
      const events = [];
      let tellReporter = null;

      if (action === "reopen") {
        if (existing.status !== "resolved")
          return res
            .status(409)
            .json({ error: "Only a resolved report can be reopened" });
        if (note.length < 3)
          return res
            .status(400)
            .json({ error: "Say why it is being reopened" });
        set.status = "open";
        set.reopenedAt = nowIso;
        for (const k of [
          "resolvedAt",
          "resolvedBy",
          "resolutionNote",
          "outcome",
        ])
          unset[k] = "";
        events.push(event("reopened"));
      } else if (existing.status === "resolved" && action !== "note") {
        return res.status(409).json({ error: "Already resolved" });
      } else if (action === "ack") {
        if (existing.status !== "open")
          return res.status(409).json({ error: "Already acknowledged" });
        set.status = "acknowledged";
        set.acknowledgedAt = nowIso;
        set.acknowledgedBy = session.sub;
        set.acknowledgedNote = note || "Papunta na ang tulong";
        events.push(event("acknowledged"));
        tellReporter = "seen";
      } else if (action === "assign") {
        let who = me;
        if (req.body?.userId && req.body.userId !== session.sub) {
          if (typeof req.body.userId !== "string")
            return res.status(400).json({ error: "Choose a staff member" });
          const u = await db
            .collection("users")
            .findOne({ _id: req.body.userId });
          if (!u || u.active === false)
            return res.status(404).json({ error: "Staff member not found" });
          who = { id: u._id, name: u.name || u.username };
        }
        set.assignedTo = who;
        set.assignedAt = nowIso;
        events.push(event("assigned", { to: who }));
        if (existing.status === "open") {
          // someone owns it now, so it counts as answered
          set.status = "acknowledged";
          set.acknowledgedAt = nowIso;
          set.acknowledgedBy = session.sub;
          set.acknowledgedNote = note || "Papunta na ang tulong";
          events.push(event("acknowledged"));
          tellReporter = "seen";
        }
      } else if (action === "note") {
        if (!note)
          return res.status(400).json({ error: "Write the update first" });
        events.push(event("note"));
      } else {
        // resolve
        const outcome = req.body?.outcome ?? "resolved";
        if (typeof outcome !== "string" || !OUTCOMES[outcome])
          return res.status(400).json({ error: "Choose how it ended" });
        if (outcome === "referred" && note.length < 3)
          return res.status(400).json({ error: "Say who it was referred to" });
        set.status = "resolved";
        set.resolvedAt = nowIso;
        set.resolvedBy = session.sub;
        set.resolutionNote = note;
        set.outcome = outcome;
        events.push(event("resolved", { outcome }));
        tellReporter = "resolved";
      }

      const update = { $set: { ...set, timeline: [...history, ...events] } };
      if (Object.keys(unset).length) update.$unset = unset;
      await col.updateOne({ _id: id }, update);
      const fresh = { ...existing, ...set };
      for (const k of Object.keys(unset)) delete fresh[k];
      fresh.timeline = [...history, ...events];
      if (tellReporter && existing.reporter?.id)
        await notify(
          db,
          { role: existing.reporter.role, id: existing.reporter.id },
          tellReporter === "seen"
            ? msg.reportSeen(fresh)
            : msg.reportResolved(fresh),
        );
      return res.status(200).json(present(fresh));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
