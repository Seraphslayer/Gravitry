import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";
import { hashPassword } from "./_auth.js";
import { randomInt } from "node:crypto";

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
  "lastLocation",
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

// ---------------------------------------------------------------------------
// Admin: create driver accounts (one at a time, or many from an Excel sheet).
// ---------------------------------------------------------------------------
const MAX_IMPORT_ROWS = 50;
const DEFAULT_TERMINAL = "T1";

// Same rules as passenger passwords (see passwordError in api/auth.js).
function passwordError(password) {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter";
  if (!/[^A-Za-z0-9\s]/.test(password))
    return "Password needs a special character (e.g. ! @ # $ %)";
  return null;
}

// Random password that satisfies the rules above. Shown to the admin once.
function generatePassword() {
  const pick = (chars) => chars[randomInt(chars.length)];
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digit = "23456789";
  const special = "!@#$%";
  const all = lower + upper + digit;
  const chars = [pick(lower), pick(upper), pick(digit), pick(special)];
  while (chars.length < 10) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const clean = (v, max = 80) =>
  v == null ? "" : String(v).trim().slice(0, max);

async function usernameTaken(db, username) {
  for (const name of ["users", "drivers", "passengers"]) {
    if (await db.collection(name).findOne({ username })) return true;
  }
  return false;
}

// Validates one row and inserts the driver (and their own tricycle record when
// a unit number is given). Returns { ok:true, id, username, password } or
// { ok:false, error }. Never throws for bad input.
async function createDriver(db, input) {
  const name = clean(input.name, 80);
  const username = clean(input.username, 40);
  if (!name) return { ok: false, error: "Name is required" };
  if (!username) return { ok: false, error: "Username is required" };
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username))
    return {
      ok: false,
      error: "Username must be 3-40 letters, numbers, . _ -",
    };

  let password = clean(input.password, 100);
  const generated = !password;
  if (generated) password = generatePassword();
  else {
    const pe = passwordError(password);
    if (pe) return { ok: false, error: pe };
  }

  const unit = clean(input.unit, 20).toUpperCase();
  const plate = clean(input.plate, 20).toUpperCase();
  if (unit && !plate)
    return {
      ok: false,
      error: "Plate number is required when a unit is given",
    };

  const nfcId = clean(input.nfcId, 40);
  const status = (v) =>
    String(v).toLowerCase() === "expired" ? "expired" : "valid";

  if (await usernameTaken(db, username))
    return { ok: false, error: `Username "${username}" is already taken` };
  if (nfcId && (await db.collection("drivers").findOne({ nfcId })))
    return { ok: false, error: "That NFC card is already assigned" };
  if (nfcId && (await db.collection("staff_cards").findOne({ _id: nfcId })))
    return { ok: false, error: "That NFC card is a staff card" };
  if (unit && (await db.collection("tricycles").findOne({ _id: unit })))
    return { ok: false, error: `Unit ${unit} is already registered` };

  // Next free id D<number>.
  const existing = await db
    .collection("drivers")
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const max = existing.reduce((m, d) => {
    const n = /^D(\d+)$/.exec(d._id);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  const id = `D${max + 1}`;

  const doc = {
    _id: id,
    name,
    license: clean(input.license, 30),
    contact: clean(input.contact, 30),
    unit: unit || null,
    plate: plate || null,
    status: "off_duty",
    rating: 5,
    tripsCompleted: 0,
    licenseStatus: status(input.licenseStatus),
    franchiseStatus: status(input.franchiseStatus),
    username,
    passwordHash: hashPassword(password),
  };
  if (nfcId) doc.nfcId = nfcId;

  try {
    await db.collection("drivers").insertOne(doc);
  } catch (e) {
    if (e?.code === 11000)
      return { ok: false, error: "Duplicate driver, please try again" };
    throw e;
  }
  if (unit) {
    await db.collection("tricycles").insertOne({
      _id: unit,
      plate,
      driverId: id,
      driver: name,
      status: "off_duty",
      terminal: DEFAULT_TERMINAL,
    });
  }
  return { ok: true, id, name, username, password, generated };
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
        // Remembered even after the driver goes offline, so TODA staff can
        // see where each driver was last (admin map only).
        update.$set.lastLocation = { lat, lng, at: nowIso };
      } else if (!online) {
        // Going offline stops sharing the position right away.
        update.$unset = { appLocation: "" };
      }
      await col.updateOne({ _id: session.driverId }, update);
      return res.status(200).json({ online });
    }

    // POST /api/drivers?action=create  { name, username, password?, license?,
    //   contact?, unit?, plate?, nfcId?, licenseStatus?, franchiseStatus? }
    // POST /api/drivers?action=import  { rows: [ same fields... ] }
    // Admin only. A blank password is replaced with a generated one, returned
    // once so the admin can hand it to the driver.
    if (req.method === "POST" && (action === "create" || action === "import")) {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;

      if (action === "create") {
        const r = await createDriver(db, req.body || {});
        if (!r.ok) return res.status(400).json({ error: r.error });
        return res.status(201).json(r);
      }

      const rows = req.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ error: "No rows to import" });
      if (rows.length > MAX_IMPORT_ROWS)
        return res
          .status(400)
          .json({ error: `At most ${MAX_IMPORT_ROWS} drivers per file` });
      const results = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r =
          row && typeof row === "object"
            ? await createDriver(db, row)
            : { ok: false, error: "Invalid row" };
        results.push({ row: i + 1, ...r });
      }
      return res.status(200).json({
        created: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      });
    }

    // GET /api/drivers?action=locations   (admin only)
    // Every driver's last shared position for the admin map. Never part of the
    // public driver list.
    if (req.method === "GET" && action === "locations") {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const docs = await col
        .find({}, { projection: { passwordHash: 0, username: 0 } })
        .toArray();
      return res.status(200).json(
        docs.map((d) => {
          const p = withPresence(d);
          const loc = d.lastLocation || d.appLocation || null;
          return {
            id: d._id,
            name: d.name,
            unit: d.unit || null,
            contact: d.contact || null,
            status: d.status || null,
            live: p.appActive && !!d.appLocation,
            location: loc,
          };
        }),
      );
    }

    if (req.method === "GET") {
      // Never expose passwordHash or login username to the frontend - the
      // driver list is read by the kiosk, passenger app, and admin dashboard,
      // none of which need credentials.
      const docs = await col
        .find(
          {},
          {
            projection: {
              passwordHash: 0,
              username: 0,
              appLocation: 0,
              lastLocation: 0,
            },
          },
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
        {
          projection: {
            passwordHash: 0,
            username: 0,
            appLocation: 0,
            lastLocation: 0,
          },
        },
      );
      return res.status(200).json(withPresence(doc));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
