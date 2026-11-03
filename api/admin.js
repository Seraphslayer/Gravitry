import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";
import { phDate, driverAppActive } from "./_dispatch.js";

// Admin-only tools.
//   GET /api/admin?action=export&collection=requests&format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD
//       Download one collection. Passwords, PIN hashes and ID photos are never
//       included. `from`/`to` (optional) limit by date.
//   GET /api/admin?action=analytics&from=YYYY-MM-DD&to=YYYY-MM-DD
//       Rides, income, busy hours, waiting time, drivers and incidents for the
//       Reports tab. Days are Philippine days. Default: the last 30 days.
//   GET /api/admin?action=status
//       Health of the system for the Status tab (kiosk, database, drivers...).
//   GET /api/admin?action=collections
//       The collections that can be exported, with how many records each has.
//
// A full backup = export every collection as JSON (the Data tab does this).
// (MongoDB Atlas also keeps its own backups; this is the copy you can hold.)

// collection -> { date field used by from/to, fields that must never leave }
const EXPORTABLE = {
  requests: { dateField: "ts", hide: [] },
  drivers: { dateField: null, hide: ["passwordHash"] },
  tricycles: { dateField: null, hide: [] },
  passengers: { dateField: "createdAt", hide: ["passwordHash"] },
  attendance: { dateField: "date", hide: [] },
  reports: { dateField: "ts", hide: [] },
  staff_cards: { dateField: null, hide: ["pinHash"] },
  settings: { dateField: null, hide: [] },
  terminal_line: { dateField: null, hide: [] },
};

// One response must stay under Vercel's ~4.5 MB limit, so very large
// collections are cut and flagged; narrow the dates and download again.
const MAX_ROWS = 20000;

const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function csvCell(v) {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // A cell that starts with = + - @ would run as a formula in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const cols = [];
  for (const r of rows)
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  // BOM so Excel reads the file as UTF-8 (names with accents, Filipino text).
  return "\uFEFF" + lines.join("\r\n");
}

// ---- Reports ---------------------------------------------------------------
const MAX_ANALYTICS_ROWS = 50000;
const DAY_MS = 86400000;
const money = (n) => Math.round(n * 100) / 100;
const minutes = (a, b) => (new Date(b) - new Date(a)) / 60000;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return money(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const avg = (xs) =>
  xs.length ? money(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

export async function buildAnalytics(db, from, to) {
  const fromIso = new Date(`${from}T00:00:00+08:00`).toISOString();
  const toIso = new Date(`${to}T23:59:59.999+08:00`).toISOString();
  const range = { $gte: fromIso, $lte: toIso };

  const rides = (
    await db.collection("requests").find({ ts: range }).toArray()
  ).slice(0, MAX_ANALYTICS_ROWS);
  const done = rides.filter((r) => r.status === "completed");

  // one bucket per Philippine day, even the quiet ones
  const days = {};
  for (
    let t = new Date(`${from}T00:00:00+08:00`).getTime();
    phDate(t) <= to;
    t += DAY_MS
  )
    days[phDate(t)] = { date: phDate(t), rides: 0, income: 0 };
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, rides: 0 }));
  const terminals = {};
  const drivers = {};
  let income = 0;
  const bySource = { kiosk: 0, app: 0 };
  let discounted = 0;
  const waits = [];

  for (const r of done) {
    const fare = Number(r.fare) || 0;
    income += fare;
    const day = days[phDate(new Date(r.ts).getTime())];
    if (day) {
      day.rides += 1;
      day.income += fare;
    }
    hours[(new Date(r.ts).getUTCHours() + 8) % 24].rides += 1;
    const t = (terminals[r.origin] ??= {
      terminal: r.origin,
      rides: 0,
      income: 0,
    });
    t.rides += 1;
    t.income += fare;
    bySource[r.source === "kiosk" ? "kiosk" : "app"] += 1;
    if (r.discountApplied || r.discountType) discounted += 1;
    if (r.acceptedAt && r.ts) {
      const w = minutes(r.ts, r.acceptedAt);
      if (w >= 0 && w < 24 * 60) waits.push(w);
    }
    if (r.driverId) {
      const d = (drivers[r.driverId] ??= {
        id: r.driverId,
        name: r.driver || r.driverId,
        unit: r.unit || null,
        rides: 0,
        income: 0,
        stars: [],
      });
      d.rides += 1;
      d.income += fare;
      if (r.rating?.stars) d.stars.push(r.rating.stars);
    }
  }

  const reports = await db.collection("reports").find({ ts: range }).toArray();
  const responses = reports
    .filter((r) => r.acknowledgedAt)
    .map((r) => minutes(r.ts, r.acknowledgedAt));
  const attendance = await db
    .collection("attendance")
    .find({ date: { $gte: from, $lte: to } })
    .toArray();
  const attendedDrivers = new Set(attendance.map((a) => a.driverId));

  return {
    from,
    to,
    totals: {
      booked: rides.length,
      completed: done.length,
      cancelled: rides.filter((r) => r.status === "cancelled").length,
      stillWaiting: rides.filter((r) => r.status === "pending").length,
      income: money(income),
      averageFare: avg(done.map((r) => Number(r.fare) || 0)),
      kiosk: bySource.kiosk,
      app: bySource.app,
      discounted,
      rated: done.filter((r) => r.rating?.stars).length,
      averageStars: avg(done.map((r) => r.rating?.stars).filter(Boolean)),
    },
    waitMinutes: {
      average: avg(waits),
      median: median(waits),
      over10: waits.filter((w) => w > 10).length,
      measured: waits.length,
    },
    perDay: Object.values(days).map((d) => ({ ...d, income: money(d.income) })),
    perHour: hours,
    perTerminal: Object.values(terminals).map((t) => ({
      ...t,
      income: money(t.income),
    })),
    topDrivers: Object.values(drivers)
      .map(({ stars, ...d }) => ({
        ...d,
        income: money(d.income),
        averageStars: avg(stars),
      }))
      .sort((a, b) => b.rides - a.rides)
      .slice(0, 10),
    incidents: {
      sos: reports.filter((r) => r.kind === "sos").length,
      incidents: reports.filter((r) => r.kind === "incident").length,
      resolved: reports.filter((r) => r.status === "resolved").length,
      averageResponseMinutes: avg(responses),
    },
    attendance: {
      attendanceRecords: attendance.length,
      distinctDrivers: attendedDrivers.size,
    },
    truncated: rides.length >= MAX_ANALYTICS_ROWS,
  };
}

// ---- System status ---------------------------------------------------------
const KIOSK_OK_SECONDS = 90;

export async function buildStatus(db) {
  const t0 = Date.now();
  await db.collection("settings").findOne({ _id: "tariff" });
  const dbMs = Date.now() - t0;

  const hb = await db
    .collection("settings")
    .findOne({ _id: "kiosk-heartbeat" });
  const kioskAge = hb?.at
    ? (Date.now() - new Date(hb.at).getTime()) / 1000
    : null;

  const drivers = await db.collection("drivers").find({}).toArray();
  const active = drivers.filter((d) => driverAppActive(d));
  const pending = await db
    .collection("requests")
    .find({ status: "pending" })
    .toArray();
  const stuck = pending.filter((r) => Date.now() - new Date(r.ts) > 10 * 60000);
  const alerts = await db
    .collection("reports")
    .find({ status: { $in: ["open", "acknowledged"] } })
    .toArray();
  const lastTap = (
    await db
      .collection("attendance")
      .find({})
      .sort({ lastTapAt: -1 })
      .limit(1)
      .toArray()
  )[0];
  const lastRide = (
    await db.collection("requests").find({}).sort({ ts: -1 }).limit(1).toArray()
  )[0];
  const line = await db.collection("terminal_line").countDocuments({});

  const checks = [
    {
      key: "database",
      label: "Database",
      ok: dbMs < 1500,
      detail: `${dbMs} ms response`,
    },
    {
      key: "kiosk",
      label: "Kiosk",
      ok: kioskAge != null && kioskAge < KIOSK_OK_SECONDS,
      detail:
        kioskAge == null
          ? "Never reported in"
          : kioskAge < KIOSK_OK_SECONDS
            ? `Online (reported ${Math.round(kioskAge)}s ago)`
            : `Not reporting for ${Math.round(kioskAge / 60)} min`,
      lastSeen: hb?.at || null,
      apiErrors: hb?.apiErrors ?? null,
    },
    {
      key: "waiting",
      label: "Waiting rides",
      ok: stuck.length === 0,
      detail: stuck.length
        ? `${stuck.length} ride(s) waiting more than 10 minutes`
        : `${pending.length} waiting, none stuck`,
    },
    {
      key: "sos",
      label: "SOS / incidents",
      ok: !alerts.some((a) => a.kind === "sos"),
      detail: `${alerts.length} open (${alerts.filter((a) => a.kind === "sos").length} SOS)`,
    },
  ];
  return {
    at: new Date().toISOString(),
    ok: checks.every((c) => c.ok),
    checks,
    numbers: {
      driversTotal: drivers.length,
      driversOnline: active.length,
      inLine: line,
      pendingRides: pending.length,
      lastRideAt: lastRide?.ts || null,
      lastCardTapAt: lastTap?.lastTapAt || null,
    },
  };
}

export default async function handler(req, res) {
  try {
    const { action } = req.query;
    if (req.method !== "GET")
      return res.status(405).json({ error: "Method not allowed" });
    const session = requireSession(req, res, ["admin"]);
    if (!session) return;
    const db = await getDb();

    if (action === "analytics") {
      const today = phDate();
      const day = (v, d) => (isDay(v) ? v : d);
      let to = day(req.query.to, today);
      let from = day(
        req.query.from,
        phDate(new Date(`${to}T00:00:00+08:00`).getTime() - 29 * DAY_MS),
      );
      if (from > to) [from, to] = [to, from];
      const span = (new Date(to) - new Date(from)) / DAY_MS;
      if (span > 366)
        return res.status(400).json({ error: "Pick at most one year" });
      return res.status(200).json(await buildAnalytics(db, from, to));
    }

    if (action === "status") return res.status(200).json(await buildStatus(db));

    if (action === "collections") {
      const out = [];
      for (const name of Object.keys(EXPORTABLE))
        out.push({
          name,
          count: await db.collection(name).countDocuments({}),
        });
      return res.status(200).json(out);
    }

    if (action === "export") {
      const name = req.query.collection;
      const spec = typeof name === "string" ? EXPORTABLE[name] : null;
      if (!spec) return res.status(400).json({ error: "Unknown collection" });
      const format = req.query.format === "csv" ? "csv" : "json";

      const filter = {};
      const { from, to } = req.query;
      if ((from && !isDay(from)) || (to && !isDay(to)))
        return res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
      if ((from || to) && spec.dateField) {
        filter[spec.dateField] = {};
        if (from) filter[spec.dateField].$gte = from;
        // Timestamps are ISO strings, so "to" must include that whole day.
        if (to) filter[spec.dateField].$lt = `${to}\uFFFF`;
      }

      let rows = await db.collection(name).find(filter).toArray();
      const truncated = rows.length > MAX_ROWS;
      if (truncated) rows = rows.slice(0, MAX_ROWS);
      rows = rows.map((r) => {
        const c = { ...r };
        for (const f of spec.hide) delete c[f];
        return c;
      });

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("X-Truncated", truncated ? "1" : "0");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="gravitry-${name}-${stamp}.${format}"`,
      );
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        return res.status(200).send(toCsv(rows));
      }
      return res.status(200).json({
        collection: name,
        exportedAt: new Date().toISOString(),
        truncated,
        count: rows.length,
        rows,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
