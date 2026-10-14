import { getDb } from "./_db.js";
import { requireSession, isNonEmptyString } from "./_authz.js";

// Official TODA fare matrix. The regular per-person fare is the only value
// stored per route; every other column of the posted matrix follows from it:
//   special trip       = 3 x regular   (15 -> 45, 20 -> 60)
//   discounted         = 80% of regular (15 -> 12, 20 -> 16)  student/senior/PWD
//   discounted special = 80% of special (45 -> 36, 60 -> 48)
// So editing one number in the admin Fares tab keeps all four columns correct.
function ratesFor(regular) {
  return {
    regular,
    special: regular * 3,
    discounted: Math.round(regular * 0.8),
    discountedSpecial: Math.round(regular * 3 * 0.8),
  };
}

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const col = db.collection("fares");

    if (req.method === "GET") {
      const docs = await col.find({}).toArray();
      const map = {};
      // Default: { "T1-T2": 15 } (regular per-person fare), exactly as before,
      // so the existing kiosk / passenger / admin screens keep working.
      // With ?full=1: { "T1-T2": { regular, special, discounted, discountedSpecial } }
      const full = req.query.full === "1";
      for (const d of docs) map[d._id] = full ? ratesFor(d.fare) : d.fare;
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
      return res.status(200).json({ key, fare, rates: ratesFor(fare) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
