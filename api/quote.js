import { getDb } from "./_db.js";
import { getSessionFromReq } from "./_auth.js";
import { withinRate } from "./_images.js";
import {
  cleanPoint,
  routeDistance,
  regularFareForMeters,
  buildPricing,
  signQuote,
} from "./_fare.js";

// POST /api/quote  { pickup: {lat, lng, label}, dropoff: {lat, lng, label} }
//
// Works out the real road distance between the two exact map points, turns it
// into a fare using the TODA tariff (see _fare.js), and returns a signed quote
// token. The booking request must carry that token, so the passenger is always
// charged exactly what this screen showed. Public: the kiosk has no login.
// A logged-in passenger with a staff-verified discount gets it applied here.
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const db = await getDb();

    // The route lookup uses a free shared service, so cap how often this can
    // be called (across everyone) to keep it from being abused.
    if (!(await withinRate(db, "quote", 120, 60 * 1000))) {
      return res
        .status(429)
        .json({ error: "Too many fare lookups right now. Try again shortly." });
    }

    const pickup = cleanPoint(req.body?.pickup);
    const dropoff = cleanPoint(req.body?.dropoff);
    if (!pickup || !dropoff) {
      return res
        .status(400)
        .json({ error: "A valid pickup and drop-off point are required" });
    }

    const { meters, geometry, estimated } = await routeDistance(
      pickup,
      dropoff,
    );
    const regularFare = regularFareForMeters(meters);

    let passenger = null;
    const session = getSessionFromReq(req);
    if (session?.role === "passenger") {
      passenger = await db
        .collection("passengers")
        .findOne(
          { _id: session.passengerId },
          { projection: { status: 1, discountType: 1 } },
        );
    }
    const pricing = buildPricing(regularFare, {
      passenger,
      source: passenger ? "app" : "kiosk",
      claim: null,
    });

    const quoteToken = signQuote({
      pickup,
      dropoff,
      meters,
      estimated,
      regularFare,
    });

    return res.status(200).json({
      quoteToken,
      distanceMeters: meters,
      estimated,
      geometry,
      regularFare,
      fare: pricing.fare,
      discountType: pricing.discountType || null,
      discountApplied: !!pricing.discountApplied,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
