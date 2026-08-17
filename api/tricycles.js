import { getDb } from "./_db.js";

export default async function handler(req, res) {
  try {
    const db = await getDb();
    if (req.method === "GET") {
      const docs = await db.collection("tricycles").find({}).toArray();
      return res.status(200).json(docs);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
