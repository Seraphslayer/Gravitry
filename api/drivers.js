import { getDb } from "./_db.js";

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("drivers");
    const { id } = req.query;

    if (req.method === "GET") {
      const docs = await col.find({}).toArray();
      return res.status(200).json(docs);
    }

    if (req.method === "PATCH") {
      if (!id) return res.status(400).json({ error: "id query param is required" });
      const patch = { ...(req.body || {}) };
      delete patch._id;
      await col.updateOne({ _id: id }, { $set: patch });
      const doc = await col.findOne({ _id: id });
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
