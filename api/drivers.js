import { getDb } from "./_db.js";
import { requireSession } from "./_authz.js";

// Fields nobody but the login system should ever see or be able to overwrite
// through this endpoint.
const SENSITIVE_FIELDS = ["passwordHash", "username", "_id"];

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("drivers");
    const { id } = req.query;

    if (req.method === "GET") {
      // Never expose passwordHash or login username to the frontend — the
      // driver list is read by the kiosk, passenger app, and admin dashboard,
      // none of which need credentials.
      const docs = await col
        .find({}, { projection: { passwordHash: 0, username: 0 } })
        .toArray();
      return res.status(200).json(docs);
    }

    if (req.method === "PATCH") {
      // Only TODA admins can edit driver records.
      const session = requireSession(req, res, ["admin"]);
      if (!session) return;

      if (!id)
        return res.status(400).json({ error: "id query param is required" });
      const patch = { ...(req.body || {}) };
      for (const field of SENSITIVE_FIELDS) delete patch[field];

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      await col.updateOne({ _id: id }, { $set: patch });
      const doc = await col.findOne(
        { _id: id },
        { projection: { passwordHash: 0, username: 0 } },
      );
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
