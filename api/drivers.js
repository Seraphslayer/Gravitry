import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";

// Fields nobody but the login system should ever see or be able to overwrite
// through this endpoint. The presence fields are only ever written by the
// driver's own heartbeat below.
const SENSITIVE_FIELDS = [
  "passwordHash",
  "username",
  "_id",
  "appOnline",
  "appLastSeen",
  "appLocation",
];

// A driver counts as "active" if their Driver app is switched to Online AND it
// reported in recently. The app sends a heartbeat about every 15 seconds, so
// if it goes quiet (phone off, signal lost, browser closed) the driver drops
// to "off duty" on their own after this long.
const PRESENCE_TIMEOUT_MS = 45 * 1000;

function withPresence(doc) {
  if (!doc) return doc;
  const lastSeen = doc.appLastSeen ? new Date(doc.appLastSeen).getTime() : 0;
  const appActive =
    doc.appOnline === true && Date.now() - lastSeen < PRESENCE_TIMEOUT_MS;
  return { ...doc, appActive };
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("drivers");
    const { id, action } = req.query;

    // POST /api/drivers?action=presence  { online: true | false, lat?, lng? }
    // Sent by the Driver app: when the driver taps Online / Offline, and every
    // few seconds while Online (faster during a trip). The driver is always
    // taken from the session. The GPS position is kept only so the passenger
    // being picked up can watch their driver arrive (see action=track in
    // /api/requests); it is never returned by the public driver list.
    if (req.method === "POST" && action === "presence") {
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const online = req.body?.online === true;
      const nowIso = new Date().toISOString();
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const hasPosition =
        online &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= 4 &&
        lat <= 22 &&
        lng >= 116 &&
        lng <= 128;
      const update = {
        $set: { appOnline: online, appLastSeen: nowIso },
      };
      if (hasPosition) {
        update.$set.appLocation = { lat, lng, at: nowIso };
      } else if (!online) {
        // Going offline stops sharing the position right away.
        update.$unset = { appLocation: "" };
      }
      await col.updateOne({ _id: session.driverId }, update);
      return res.status(200).json({ online });
    }

    if (req.method === "GET") {
      // Never expose passwordHash or login username to the frontend - the
      // driver list is read by the kiosk, passenger app, and admin dashboard,
      // none of which need credentials.
      const docs = await col
        .find(
          {},
          { projection: { passwordHash: 0, username: 0, appLocation: 0 } },
        )
        .toArray();
      return res.status(200).json(docs.map(withPresence));
    }

    if (req.method === "PATCH") {
      // Only TODA admins can edit driver records.
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;

      if (!id)
        return res.status(400).json({ error: "id query param is required" });
      const patch = { ...(req.body || {}) };
      for (const field of SENSITIVE_FIELDS) delete patch[field];
      for (const f of ["licenseStatus", "franchiseStatus"]) {
        if (f in patch && !["valid", "expired"].includes(patch[f]))
          return res
            .status(400)
            .json({ error: `${f} must be valid or expired` });
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      await col.updateOne({ _id: id }, { $set: patch });
      const doc = await col.findOne(
        { _id: id },
        { projection: { passwordHash: 0, username: 0, appLocation: 0 } },
      );
      return res.status(200).json(withPresence(doc));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
