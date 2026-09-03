import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString } from "./_authz.js";

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("fares");

    if (req.method === "GET") {
      const docs = await col.find({}).toArray();
      const map = {};
      for (const d of docs) map[d._id] = d.fare;
      return res.status(200).json(map);
    }

    if (req.method === "PATCH") {
      // Only TODA admins can change official fares.
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;

      const { origin, destination, fare } = req.body || {};
      if (!isNonEmptyString(origin) || !isNonEmptyString(destination)) {
        return res
          .status(400)
          .json({ error: "origin and destination are required" });
      }
      if (typeof fare !== "number" || !Number.isFinite(fare) || fare <= 0) {
        return res
          .status(400)
          .json({ error: "fare must be a positive number" });
      }

      const key = `${origin}-${destination}`;
      await col.updateOne(
        { _id: key },
        {
          $set: { origin, destination, fare, updatedAt: new Date() },
          $push: {
            history: { fare, changedAt: new Date(), changedBy: session.sub },
          },
        },
        { upsert: true },
      );
      return res.status(200).json({ key, fare });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
