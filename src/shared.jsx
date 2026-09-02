import { useEffect, useState } from "react";
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

// ── Terminals — static, rarely change, so kept on the frontend rather than DB ──
// NOTE: placeholder GPS offsets around the confirmed complex center. Swap in
// real per-terminal coordinates once the deployment site is finalized.
export const TERMINALS = [
  {
    id: "T1",
    name: "Terminal A (Sample)",
    short: "Terminal A",
    lat: 14.3566,
    lng: 120.917,
  },
  {
    id: "T2",
    name: "Terminal B (Sample)",
    short: "Terminal B",
    lat: 14.3556,
    lng: 120.9178,
  },
  {
    id: "T3",
    name: "Terminal C (Sample)",
    short: "Terminal C",
    lat: 14.3568,
    lng: 120.9179,
  },
  {
    id: "T4",
    name: "Terminal D (Sample)",
    short: "Terminal D",
    lat: 14.3554,
    lng: 120.9168,
  },
];

export const getTerm = (id) => TERMINALS.find((t) => t.id === id);
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });

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
