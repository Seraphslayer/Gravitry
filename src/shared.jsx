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

// ── Mary Cris Complex — REAL coordinates (confirmed via Nominatim) ──────────
// Mary Cris Complex, Pasong Camachile II, General Trias, Cavite, Calabarzon, 4107, Philippines
export const COMPLEX_CENTER = [14.35612, 120.91735];

// ── Terminals (placeholder pins, offset slightly around the REAL complex center) ─
// NOTE: exact terminal locations still TBD — these are small offsets around the
// confirmed complex center so pins land inside/near the actual site. Swap in real
// per-terminal coordinates once the deployment site is finalized.
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

export const INIT_DRIVERS = [
  {
    id: "D1",
    name: "Rolando Dela Cruz",
    license: "N01-23-456789",
    contact: "0917 123 4567",
    unit: "MCC-001",
    status: "available",
    online: true,
    rating: 4.9,
    tripsCompleted: 214,
    licenseExpiry: "2027-03-15",
    franchiseExpiry: "2026-11-02",
  },
  {
    id: "D2",
    name: "Eduardo Santos",
    license: "N01-23-567890",
    contact: "0918 234 5678",
    unit: "MCC-002",
    status: "on_trip",
    online: true,
    rating: 4.7,
    tripsCompleted: 189,
    licenseExpiry: "2026-08-20",
    franchiseExpiry: "2026-08-05",
  },
  {
    id: "D3",
    name: "Marlon Reyes",
    license: "N01-23-678901",
    contact: "0919 345 6789",
    unit: "MCC-003",
    status: "available",
    online: true,
    rating: 4.8,
    tripsCompleted: 301,
    licenseExpiry: "2028-01-10",
    franchiseExpiry: "2027-04-18",
  },
  {
    id: "D4",
    name: "Danilo Bautista",
    license: "N01-23-789012",
    contact: "0920 456 7890",
    unit: "MCC-004",
    status: "available",
    online: false,
    rating: 4.6,
    tripsCompleted: 98,
    licenseExpiry: "2026-07-30",
    franchiseExpiry: "2026-12-01",
  },
  {
    id: "D5",
    name: "Felix Villanueva",
    license: "N01-23-890123",
    contact: "0921 567 8901",
    unit: "MCC-005",
    status: "off_duty",
    online: false,
    rating: 4.3,
    tripsCompleted: 47,
    licenseExpiry: "2026-06-01",
    franchiseExpiry: "2026-06-15",
  },
];

// ── Document expiry status helper ────────────────────────────────────────────
// "today" is fixed to match the app's known current date so the demo is stable.
const TODAY = new Date("2026-07-21");
export function getDocStatus(dateStr) {
  const exp = new Date(dateStr);
  const daysLeft = Math.round((exp - TODAY) / 86400000);
  if (daysLeft < 0) return { label: "Expired", variant: "red", daysLeft };
  if (daysLeft <= 30)
    return { label: `${daysLeft}d left`, variant: "yellow", daysLeft };
  return { label: "Valid", variant: "green", daysLeft };
}

export const INIT_TRICYCLES = [
  {
    id: "MCC-001",
    plate: "ABL-1234",
    driver: "Rolando Dela Cruz",
    status: "available",
    terminal: "T1",
  },
  {
    id: "MCC-002",
    plate: "ABL-2345",
    driver: "Eduardo Santos",
    status: "on_trip",
    terminal: null,
  },
  {
    id: "MCC-003",
    plate: "ABL-3456",
    driver: "Marlon Reyes",
    status: "available",
    terminal: "T1",
  },
  {
    id: "MCC-004",
    plate: "ABL-4567",
    driver: "Danilo Bautista",
    status: "available",
    terminal: "T1",
  },
  {
    id: "MCC-005",
    plate: "ABL-5678",
    driver: "Felix Villanueva",
    status: "off_duty",
    terminal: "T3",
  },
];

export const FARES = {
  "T1-T2": 15,
  "T1-T3": 12,
  "T1-T4": 18,
  "T2-T1": 15,
  "T2-T3": 12,
  "T2-T4": 15,
  "T3-T1": 12,
  "T3-T2": 12,
  "T3-T4": 15,
  "T4-T1": 18,
  "T4-T2": 15,
  "T4-T3": 15,
};

export const SEED_LOGS = [
  {
    id: "DR-001",
    origin: "T4",
    destination: "T1",
    driver: "Rolando Dela Cruz",
    unit: "MCC-001",
    plate: "ABL-1234",
    fare: 18,
    ts: new Date(Date.now() - 12 * 60000).toISOString(),
    status: "completed",
  },
  {
    id: "DR-002",
    origin: "T3",
    destination: "T2",
    driver: "Eduardo Santos",
    unit: "MCC-002",
    plate: "ABL-2345",
    fare: 12,
    ts: new Date(Date.now() - 28 * 60000).toISOString(),
    status: "completed",
  },
  {
    id: "DR-003",
    origin: "T2",
    destination: "T4",
    driver: "Danilo Bautista",
    unit: "MCC-004",
    plate: "ABL-4567",
    fare: 15,
    ts: new Date(Date.now() - 51 * 60000).toISOString(),
    status: "completed",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────
export const getTerm = (id) => TERMINALS.find((t) => t.id === id);
export const getFare = (o, d) => FARES[`${o}-${d}`] || 0;
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });
let _seq = 4;
export const genId = () => `DR-${String(_seq++).padStart(3, "0")}`;

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

// ── Distance / nearest-terminal snapping ─────────────────────────────────────
// Used when the passenger searches an address or drops a pin — since tricycles
// only run fixed terminal-to-terminal routes, we snap any free-form location
// to the closest registered terminal so a valid fare can still be shown.
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // meters
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
