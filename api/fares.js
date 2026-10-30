import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";
import {
  getTariff,
  cleanTariff,
  tariffTable,
  DEFAULT_TARIFF,
} from "./_fare.js";

// The official TODA tariff.
//   GET   /api/fares   public   the numbers in force + the table worked out from them
//   PATCH /api/fares   admin    { firstKm, firstKmFare, stepKm, stepFare,
//                                discountPercent, specialMultiplier }
// Every fare a passenger is quoted comes from these numbers (see api/_fare.js),
// so a change here applies to the next quote right away. Rides already booked
// keep the fare they were quoted. Each change is kept in `history`.

async function view(db) {
  const tariff = await getTariff(db);
  const doc = await db.collection("settings").findOne({ _id: "tariff" });
  return {
    tariff,
    defaults: DEFAULT_TARIFF,
    rows: tariffTable(tariff),
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
  };
}

export default async function handler(req, res) {
  try {
    const db = await getDb();

    if (req.method === "GET") return res.status(200).json(await view(db));

    if (req.method === "PATCH") {
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;
      const { tariff, error } = cleanTariff(req.body);
      if (error) return res.status(400).json({ error });
      const now = new Date().toISOString();
      await db.collection("settings").updateOne(
        { _id: "tariff" },
        {
          $set: { value: tariff, updatedAt: now, updatedBy: session.sub },
          $push: {
            history: { value: tariff, changedAt: now, changedBy: session.sub },
          },
        },
        { upsert: true },
      );
      return res.status(200).json(await view(db));
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
