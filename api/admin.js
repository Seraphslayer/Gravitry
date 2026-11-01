import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";

// Admin-only tools.
//   GET /api/admin?action=export&collection=requests&format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD
//       Download one collection. Passwords, PIN hashes and ID photos are never
//       included. `from`/`to` (optional) limit by date.
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

export default async function handler(req, res) {
  try {
    const { action } = req.query;
    if (req.method !== "GET")
      return res.status(405).json({ error: "Method not allowed" });
    const session = requireSession(req, res, ["admin"]);
    if (!session) return;
    const db = await getDb();

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
