import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";
import {
  expiredDocsOf,
  joinLine,
  leaveLine,
  getLine,
  lineSnapshot,
} from "./_dispatch.js";
import {
  TERMINALS,
  terminalById,
  terminalNear,
  JOIN_RADIUS_METERS,
} from "./_terminals.js";

// The terminal line (see api/_dispatch.js).
//   GET  /api/queue?terminal=T1        public   drivers in line + passengers waiting
//   GET  /api/queue?action=all         admin    the same for every terminal
//   GET  /api/queue?action=mine        driver   my place in line, or null
//   POST /api/queue?action=join        driver   { lat, lng }  must be near a terminal
//   POST /api/queue?action=leave       driver   leave the line
export default async function handler(req, res) {
  try {
    const db = await getDb();
    const { action, terminal } = req.query;

    if (req.method === "GET" && action === "all") {
      if (!requireSession(req, res, ["admin"])) return;
      const all = [];
      for (const t of TERMINALS) all.push(await lineSnapshot(db, t.id));
      return res.status(200).json(all);
    }

    if (req.method === "GET" && action === "mine") {
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const entry = await db
        .collection("terminal_line")
        .findOne({ _id: session.driverId });
      if (!entry) return res.status(200).json(null);
      const line = await getLine(db, entry.terminal);
      const idx = line.findIndex((d) => d.driverId === session.driverId);
      return res.status(200).json({
        terminal: entry.terminal,
        position: idx >= 0 ? idx + 1 : null,
        lineLength: line.length,
        joinedAt: entry.joinedAt,
      });
    }

    if (req.method === "GET" && !action) {
      if (!terminalById(terminal))
        return res.status(400).json({ error: "Unknown terminal" });
      return res.status(200).json(await lineSnapshot(db, terminal));
    }

    if (req.method === "POST" && action === "join") {
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return res
          .status(400)
          .json({ error: "Your location is needed to join the line" });
      const near = terminalNear({ lat, lng }, JOIN_RADIUS_METERS);
      if (!near)
        return res.status(403).json({
          error: `Kailangan nasa loob ka ng ${JOIN_RADIUS_METERS} metro ng terminal para makapila.`,
        });
      const driver = await db
        .collection("drivers")
        .findOne({ _id: session.driverId });
      if (!driver) return res.status(404).json({ error: "Driver not found" });
      if (driver.status === "on_trip")
        return res.status(409).json({ error: "You are on a trip" });
      const expired = expiredDocsOf(driver);
      if (expired.length)
        return res.status(403).json({
          error: `Your ${expired.join(" and ")} has expired. Please renew it with TODA staff.`,
        });
      await joinLine(db, driver, near.id, "app");
      const line = await getLine(db, near.id);
      return res.status(200).json({
        terminal: near.id,
        position: line.findIndex((d) => d.driverId === driver._id) + 1,
        lineLength: line.length,
      });
    }

    if (req.method === "POST" && action === "leave") {
      const session = requireSession(req, res, ["driver"]);
      if (!session) return;
      await leaveLine(db, session.driverId);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("queue api error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
