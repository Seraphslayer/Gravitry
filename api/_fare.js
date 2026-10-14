import jwt from "jsonwebtoken";

// Distance-based fare, following the official TODA tariff posted at the
// terminals. The fare depends on how far the passenger really travels between
// the exact pickup point and the exact drop-off point - NOT on which terminal
// happens to be nearest.
//
// The poster: first kilometer PHP 15, then "additional PHP 5.00 for every
// succeeding 2 kilometers" (the posted PHP 20 is the first kilometer plus the
// first PHP 5 step). So, for the regular per-person fare:
//
//     up to 1 km ......... PHP 15
//     over 1  - 3 km ..... PHP 20
//     over 3  - 5 km ..... PHP 25
//     over 5  - 7 km ..... PHP 30   ... and so on, +PHP 5 every 2 km
//
// If the TODA charges differently, only these four numbers need to change.
const FIRST_KM = 1;
const FIRST_KM_FARE = 15;
const STEP_KM = 2;
const STEP_FARE = 5;

export function regularFareForMeters(meters) {
  const km = meters / 1000;
  if (km <= FIRST_KM) return FIRST_KM_FARE;
  return FIRST_KM_FARE + STEP_FARE * Math.ceil((km - FIRST_KM) / STEP_KM);
}

// Students, senior citizens and PWDs pay 80% of the regular fare
// (15 -> 12, 20 -> 16). Keep in sync with discountedFare() in src/shared.jsx.
export const DISCOUNT_TYPES = ["student", "senior", "pwd"];
export const discountedFare = (regular) => Math.round(regular * 0.8);

// What a passenger is charged, given the regular fare for the trip.
//  - logged-in passenger whose discount staff verified -> discount applied
//  - kiosk guest claiming a discount -> discount PENDING until the driver
//    checks the ID and taps their NFC card
export function buildPricing(regularFare, { passenger, source, claim }) {
  if (passenger) {
    const verified = (passenger.status || "verified") === "verified";
    if (verified && DISCOUNT_TYPES.includes(passenger.discountType)) {
      return {
        fare: discountedFare(regularFare),
        regularFare,
        discountType: passenger.discountType,
        discountApplied: true,
      };
    }
    return { fare: regularFare, regularFare };
  }
  if (source === "kiosk" && claim && DISCOUNT_TYPES.includes(claim)) {
    return {
      fare: discountedFare(regularFare),
      regularFare,
      discountClaim: claim,
      discountPending: true,
    };
  }
  return { fare: regularFare, regularFare };
}

// ── Points ──────────────────────────────────────────────────────────────────
// Only points inside the Philippines are accepted, so this endpoint can't be
// used as a free routing service for the rest of the world.
export function cleanPoint(p) {
  if (!p || typeof p !== "object") return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 4 || lat > 22 || lng < 116 || lng > 128) return null;
  const label =
    typeof p.label === "string" && p.label.trim()
      ? p.label.trim().slice(0, 160)
      : null;
  return { lat, lng, label };
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Real driving distance along roads, from the free OpenStreetMap routing
// service (OSRM). It is a shared demo server, so if it is slow or down we fall
// back to the straight-line distance x 1.3 (roads are longer than a straight
// line) and mark the result as estimated.
export async function routeDistance(pickup, dropoff) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}` +
      `?overview=simplified&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code === "Ok" && route && Number.isFinite(route.distance)) {
      return {
        meters: Math.round(route.distance),
        geometry: route.geometry?.coordinates || null,
        estimated: false,
      };
    }
  } catch {
    /* fall through to the estimate */
  } finally {
    clearTimeout(timer);
  }
  return {
    meters: Math.round(haversineMeters(pickup, dropoff) * 1.3),
    geometry: [
      [pickup.lng, pickup.lat],
      [dropoff.lng, dropoff.lat],
    ],
    estimated: true,
  };
}

// ── Signed quotes ───────────────────────────────────────────────────────────
// /api/quote hands the browser a signed token holding the exact points,
// distance and regular fare. /api/requests only accepts a ride with a valid
// token, so nobody can post their own distance or price, and the passenger is
// always charged exactly the fare they were shown.
const QUOTE_TTL = "15m";

export function signQuote(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET environment variable");
  return jwt.sign({ k: "quote", ...payload }, secret, {
    expiresIn: QUOTE_TTL,
  });
}

export function verifyQuote(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof token !== "string") return null;
  try {
    const p = jwt.verify(token, secret);
    return p.k === "quote" ? p : null;
  } catch {
    return null;
  }
}
