import { useEffect, useState, useRef } from "react";
import { Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// ── Design Tokens ──────────────────────────────────────────────────────────
export const C = {
  navy: "#0B2D48",
  navyLight: "#16486E",
  green: "#1C7C54",
  greenDark: "#145C3E",
  greenLight: "#ECFDF5",
  yellow: "#F7C344",
  surface: "#EFF0EC",
  white: "#FFFFFF",
  text: "#1A1A1A",
  muted: "#6B7280",
  border: "#E2E2DC",
  danger: "#DC2626",
};
export const GR = '"Space Grotesk", sans-serif';
export const IN = '"Inter", sans-serif';

// ── Mary Cris Complex — real coordinates (confirmed via Nominatim) ──────────
export const COMPLEX_CENTER = [14.35612, 120.91735];

// ── Terminals — real, confirmed GPS coordinates for Mary Cris Complex ───────
// Kept static on the frontend rather than in the DB since they rarely change.
export const TERMINALS = [
  {
    id: "T1",
    name: "Main Terminal (MCC Entrance)",
    short: "Main Terminal",
    lat: 14.354615812078766,
    lng: 120.92335026772189,
  },
  {
    id: "T2",
    name: "Terminal Beside 7-Eleven",
    short: "7-Eleven Terminal",
    lat: 14.355589361426508,
    lng: 120.91816283580978,
  },
  {
    id: "T3",
    name: "Terminal in front of Alfamart",
    short: "Alfamart Terminal",
    lat: 14.356764679932585,
    lng: 120.9168375420383,
  },
];

export const getTerm = (id) => TERMINALS.find((t) => t.id === id);
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });

// ── Fare discounts (from the official TODA fare matrix) ────────────────────
// Students, senior citizens and PWDs pay 80% of the regular fare
// (15 -> 12, 20 -> 16). Must match the rounding in api/requests.js.
export const DISCOUNTS = {
  student: { label: "Student", idName: "Student ID" },
  senior: { label: "Senior Citizen", idName: "Senior Citizen ID" },
  pwd: { label: "PWD", idName: "PWD ID" },
};
export const DISCOUNT_KEYS = Object.keys(DISCOUNTS);
export const discountLabel = (type) => DISCOUNTS[type]?.label || null;
export const discountedFare = (regular) => Math.round(regular * 0.8);

// ── Tariff (display only) ──────────────────────────────────────────────────
// The real fare is worked out on the server from the road distance between the
// exact pickup and drop-off points (api/_fare.js). This copy only feeds the
// tariff table shown to admins - keep the two in sync.
export const TARIFF = {
  rows: [
    {
      label: "First kilometer (up to 1 km)",
      regular: 15,
      special: 45,
      discounted: 12,
      discountedSpecial: 36,
    },
    {
      label: "Succeeding 2 km (over 1 km, up to 3 km)",
      regular: 20,
      special: 60,
      discounted: 16,
      discountedSpecial: 48,
    },
  ],
  beyond:
    "Then +₱5 for every additional 2 km (regular fare): over 3 km up to 5 km = ₱25, over 5 km up to 7 km = ₱30, and so on. Special trip and discounted fares follow the same steps.",
};

// ── Places: exact points picked on the map ─────────────────────────────────
// A "place" is { lat, lng, label } - a searched address, a dropped pin, the
// phone's GPS position, or a terminal. Fares use the exact point, never the
// nearest terminal.
export const shortAddress = (name) =>
  name
    ? name
        .split(",")
        .slice(0, 3)
        .map((s) => s.trim())
        .join(", ")
    : "";

export const coordLabel = (lat, lng) =>
  `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

export const terminalPlace = (t) => ({
  lat: t.lat,
  lng: t.lng,
  label: t.name,
});

// Turns map coordinates into a readable address (OpenStreetMap Nominatim).
// Returns null if it can't, so callers fall back to coordLabel().
export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`,
      { headers: { "Accept-Language": "en" } },
    );
    const data = await res.json();
    return data?.display_name ? shortAddress(data.display_name) : null;
  } catch {
    return null;
  }
}

// What to show for a ride's pickup / drop-off. New rides carry the exact
// address the passenger picked; older ones only have a terminal.
export const pickupLabel = (r) =>
  r?.pickup?.label || getTerm(r?.origin)?.name || r?.origin || "";
export const dropoffLabel = (r) =>
  r?.dropoff?.label || getTerm(r?.destination)?.name || r?.destination || "";

// The exact map point of a ride's pickup / drop-off ({ lat, lng, ... }). New
// rides carry the exact point the passenger picked; older ones only have a
// terminal, so fall back to that terminal's coordinates.
export const pickupPoint = (r) => r?.pickup || getTerm(r?.origin) || null;
export const dropoffPoint = (r) =>
  r?.dropoff || getTerm(r?.destination) || null;

// Road route between two { lat, lng } points, straight from the free OSRM
// routing service. Used by the Driver app to draw "you -> passenger" on the
// map. Never throws: if the service is slow or down it returns a straight
// line instead (estimated: true).
export async function fetchRoute(a, b) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`,
      { signal: ctrl.signal },
    );
    const data = await res.json();
    const r = data?.routes?.[0];
    if (data?.code === "Ok" && r) {
      return {
        coords: r.geometry.coordinates,
        meters: Math.round(r.distance),
        estimated: false,
      };
    }
  } catch {
    /* fall through to the straight line */
  } finally {
    clearTimeout(timer);
  }
  return {
    coords: [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ],
    meters: null,
    estimated: true,
  };
}

export const fmtKm = (meters) => {
  if (meters == null || !Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

// ── Live trip geometry (shared by the Driver app and the passenger's tracking) ──
// Straight-line distance in meters between two lat/lng points.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  return haversine(lat1, lng1, lat2, lng2);
}

export const toLatLngs = (coords) => coords.map(([lng, lat]) => [lat, lng]);

// Rough time at tricycle speed (about 20 km/h).
export const etaMinutes = (meters) => Math.max(1, Math.round(meters / 333));

// Closest point on a route (GeoJSON [lng, lat] coords) to a position, found by
// projecting onto each segment. Returns how far off the route the position is.
export function projectOnRoute(coords, p) {
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  let best = { d: Infinity, i: 0, lng: coords[0][0], lat: coords[0][1] };
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const Ax = (ax - p.lng) * kx;
    const Ay = (ay - p.lat) * ky;
    const Bx = (bx - p.lng) * kx;
    const By = (by - p.lat) * ky;
    const dx = Bx - Ax;
    const dy = By - Ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(Ax * dx + Ay * dy) / len2)) : 0;
    const d = Math.hypot(Ax + t * dx, Ay + t * dy);
    if (d < best.d) {
      best = { d, i, lng: ax + (bx - ax) * t, lat: ay + (by - ay) * t };
    }
  }
  return best;
}

// The part of the route still ahead of the driver, starting at the driver's own
// position, as [lat, lng] pairs for a Polyline, plus its length in meters. As
// the driver moves forward the line gets shorter.
export function remainingAhead(coords, p) {
  const b = projectOnRoute(coords, p);
  const ahead = [[p.lng, p.lat], [b.lng, b.lat], ...coords.slice(b.i + 1)];
  let meters = 0;
  for (let i = 0; i < ahead.length - 1; i++) {
    meters += haversine(
      ahead[i][1],
      ahead[i][0],
      ahead[i + 1][1],
      ahead[i + 1][0],
    );
  }
  return { line: toLatLngs(ahead), meters: Math.round(meters) };
}

// Road route between two fixed points, fetched once per pair of points.
export function useRoute(a, b) {
  const key = a && b ? `${a.lat},${a.lng}|${b.lat},${b.lng}` : null;
  const [route, setRoute] = useState(null);
  useEffect(() => {
    if (!key) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    fetchRoute(a, b).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return route;
}

// A route from a moving position to a target that stays up to date. It is only
// re-requested when the target changes or the mover strays well off the current
// route (wrong turn), with a cool-down so the free routing service is never
// hammered. In between, the line is just trimmed with remainingAhead().
export function useLiveRoute(from, to) {
  const toKey = to ? `${to.lat.toFixed(5)},${to.lng.toFixed(5)}` : null;
  const [route, setRoute] = useState(null);
  const last = useRef({ key: null, time: 0, busy: false });
  const valid = route && route.key === toKey ? route : null;
  // Stray limit: 80 m off the route, or 60 m further off than when the route
  // was fetched (someone standing off the road starts off the line already).
  const needsFetch =
    !!from &&
    !!to &&
    (!valid ||
      projectOnRoute(valid.coords, from).d >
        Math.max(80, (valid.baseOff || 0) + 60));
  useEffect(() => {
    if (!needsFetch || last.current.busy) return;
    const sameTarget = last.current.key === toKey;
    if (sameTarget && Date.now() - last.current.time < 8000) return;
    last.current = { key: toKey, time: Date.now(), busy: true };
    const key = toKey;
    fetchRoute(from, to)
      .then((r) =>
        setRoute({ ...r, key, baseOff: projectOnRoute(r.coords, from).d }),
      )
      .finally(() => {
        last.current.busy = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFetch, toKey, from?.lat, from?.lng]);
  return valid;
}

// Zooms a react-leaflet map so all the given { lat, lng } points fit. Runs only
// when fitKey changes, so it never fights someone panning around.
export function FitTo({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    const pts = points.filter(Boolean);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.flyTo([pts[0].lat, pts[0].lng], 17, { duration: 0.6 });
    } else {
      map.fitBounds(
        pts.map((p) => [p.lat, p.lng]),
        { padding: [60, 60], maxZoom: 17 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

// The driver's tricycle on the passenger's map. The "gv-smooth" class (see
// SmoothMarkers below) makes it glide between GPS updates instead of jumping.
export const driverMarkerIcon = L.divIcon({
  className: "gv-smooth",
  html: `<div style="width:38px;height:38px;border-radius:50%;background:${C.navy};border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;">
    <svg width="22" height="22" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 20 C10 16 13 13 17 13 H38 L46 22 H50 C53 22 55 24 55 27 V34 H8 V24 C8 22 9 20 10 20 Z" fill="${C.yellow}"/>
      <circle cx="18" cy="42" r="7" fill="${C.yellow}"/>
      <circle cx="46" cy="42" r="7" fill="${C.yellow}"/>
      <rect x="6" y="34" width="6" height="8" rx="1.5" fill="${C.yellow}"/>
    </svg>
  </div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

// Put <SmoothMarkers /> once inside a page that shows the moving driver marker.
export function SmoothMarkers() {
  return <style>{`.gv-smooth{transition:transform 3s linear;}`}</style>;
}

// Teardrop map pin
export function pinIcon(color, pulse = false) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
        ${pulse ? `<div class="gv-marker-pulse" style="width:34px;height:34px;top:0;left:0;"></div>` : ""}
        <div style="position:relative;width:26px;height:26px;border-radius:50% 50% 50% 0;background:${color};
          transform:rotate(-45deg);box-shadow:0 3px 8px rgba(0,0,0,0.35);border:2px solid #fff;"></div>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 30],
    popupAnchor: [0, -28],
  });
}
const pickupIcon = pinIcon(C.green, true);
const dropoffIcon = pinIcon(C.yellow, true);

// Draws the trip on a react-leaflet map: green pin at the exact pickup point,
// yellow pin at the exact drop-off point, the road route between them, and
// zooms so both fit. `route` is GeoJSON [lng, lat] pairs from /api/quote.
export function RouteLayer({ pickup, dropoff, route }) {
  const map = useMap();
  useEffect(() => {
    if (pickup && dropoff) {
      map.fitBounds(
        [
          [pickup.lat, pickup.lng],
          [dropoff.lat, dropoff.lng],
        ],
        { padding: [50, 50], maxZoom: 17 },
      );
    } else if (pickup) {
      map.flyTo([pickup.lat, pickup.lng], 17, { duration: 0.6 });
    }
  }, [pickup, dropoff, map]);
  return (
    <>
      {route && route.length > 1 && (
        <Polyline
          positions={route.map(([lng, lat]) => [lat, lng])}
          pathOptions={{ color: C.navy, weight: 5, opacity: 0.8 }}
        />
      )}
      {pickup && (
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
          <Popup>Pickup: {pickup.label}</Popup>
        </Marker>
      )}
      {dropoff && (
        <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
          <Popup>Drop-off: {dropoff.label}</Popup>
        </Marker>
      )}
    </>
  );
}

// ── Distance / nearest-terminal snapping (used by kiosk/passenger search + pin drop) ──
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function nearestTerminal(lat, lng, excludeId = null) {
  let best = null,
    bestDist = Infinity;
  for (const t of TERMINALS) {
    if (t.id === excludeId) continue;
    const d = haversine(lat, lng, t.lat, t.lng);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return { terminal: best, distanceMeters: Math.round(bestDist) };
}

// ── Driver document status (license / franchise): just Valid or Expired ─────
// kind is "license" or "franchise". The admin sets it with a dropdown, stored
// as licenseStatus / franchiseStatus. Drivers saved before that existed fall
// back to their old expiry date.
export function getDocStatus(driver, kind) {
  const set = driver?.[`${kind}Status`];
  let expired;
  if (set === "valid" || set === "expired") expired = set === "expired";
  else {
    const d = driver?.[`${kind}Expiry`];
    expired = !!d && new Date(d) < new Date();
  }
  return expired
    ? { value: "expired", label: "Expired", variant: "red" }
    : { value: "valid", label: "Valid", variant: "green" };
}

// ── Live GPS location — continuous tracking, shared across Kiosk/Driver/Passenger ──
// Uses watchPosition (not a one-shot fetch) so the "you are here" marker stays
// current as the device moves. Cleans up its watch on unmount. Silent no-op if
// the browser denies permission or doesn't support geolocation — callers should
// treat `position` as optional and never block core flows on it.
export function useLiveLocation() {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser.");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setError(null);
      },
      (err) => {
        setError(err.message || "Could not get your location.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return { position, error };
}

// Blue pulsing dot — used for both the persistent "you are here" live marker
// and the one-shot "use my current location" picker result.
export const myLocationIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:20px;height:20px;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.25);animation:gv-pulse 1.8s ease-out infinite;"></div>
    <div style="position:absolute;top:4px;left:4px;width:12px;height:12px;border-radius:50%;background:#3B82F6;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
  </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// ── Logo (inline SVG — no external assets needed) ────────────────────────────
export function TrikeIcon({ size = 40, color = C.yellow }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 20 C10 16 13 13 17 13 H38 L46 22 H50 C53 22 55 24 55 27 V34 H8 V24 C8 22 9 20 10 20 Z"
        fill={color}
      />
      <rect x="30" y="24" width="3" height="10" fill="#0B2D48" opacity="0.55" />
      <circle cx="18" cy="42" r="7" fill={color} />
      <circle cx="18" cy="42" r="2.6" fill="#0B2D48" opacity="0.6" />
      <circle cx="46" cy="42" r="7" fill={color} />
      <circle cx="46" cy="42" r="2.6" fill="#0B2D48" opacity="0.6" />
      <rect x="6" y="34" width="6" height="8" rx="1.5" fill={color} />
    </svg>
  );
}

export function Logo({ size = 28, dark = false }) {
  const textColor = dark ? C.navy : "#fff";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <TrikeIcon size={size} color={C.yellow} />
      <span
        style={{
          fontFamily: GR,
          fontWeight: 700,
          fontSize: size * 0.62,
          color: textColor,
          letterSpacing: 0.5,
          lineHeight: 1,
        }}
      >
        GRAVITRY
      </span>
    </div>
  );
}

// ── Mary Cris Complex address choices (signup) ──────────────────────────────
// An address is a Phase (1-12), or a Block and Lot, or both.
export const MARY_CRIS_PHASES = Array.from({ length: 12 }, (_, i) =>
  String(i + 1),
);
