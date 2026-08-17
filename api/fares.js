import { getDb } from "./_db.js";

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
      const { origin, destination, fare } = req.body || {};
      if (!origin || !destination || !fare) {
        return res.status(400).json({ error: "origin, destination, fare are required" });
      }
      const key = `${origin}-${destination}`;
      await col.updateOne(
        { _id: key },
        {
          $set: { origin, destination, fare, updatedAt: new Date() },
          $push: { history: { fare, changedAt: new Date() } },
        },
        { upsert: true }
      );
      return res.status(200).json({ key, fare });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
