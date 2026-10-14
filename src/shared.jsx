import { useEffect, useState } from "react";
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
      label: "Succeeding 2 to 5 km (over 1 km, up to 5 km)",
      regular: 20,
      special: 60,
      discounted: 16,
      discountedSpecial: 48,
    },
  ],
  beyond: "Beyond 5 km: +₱5 for every additional 5 km (regular fare)",
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

// ── Document expiry status helper (used by Admin driver management) ─────────
export function getDocStatus(dateStr) {
  const today = new Date();
  const exp = new Date(dateStr);
  const daysLeft = Math.round((exp - today) / 86400000);
  if (daysLeft < 0) return { label: "Expired", variant: "red", daysLeft };
  if (daysLeft <= 30)
    return { label: `${daysLeft}d left`, variant: "yellow", daysLeft };
  return { label: "Valid", variant: "green", daysLeft };
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
