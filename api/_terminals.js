// Terminal locations for server-side rules (queue, "is this passenger at the
// terminal"). KEEP IN SYNC with TERMINALS in src/shared.jsx.
export const TERMINALS = [
  { id: "T1", lat: 14.354615812078766, lng: 120.92335026772189 },
  { id: "T2", lat: 14.355589361426508, lng: 120.91816283580978 },
  { id: "T3", lat: 14.356764679932585, lng: 120.9168375420383 },
];

// An app passenger whose pickup point is this close to the terminal counts as
// "in the terminal" and is served with the kiosk passengers (before app
// bookings made from elsewhere).
export const AT_TERMINAL_METERS = 60;
// A driver may join a terminal's line from the Driver app when this close.
export const JOIN_RADIUS_METERS = 100;

export const terminalById = (id) => TERMINALS.find((t) => t.id === id) || null;

export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The terminal within `meters` of a point, or null.
export function terminalNear(point, meters) {
  let best = null;
  for (const t of TERMINALS) {
    const d = distanceMeters(point, t);
    if (d <= meters && (!best || d < best.d)) best = { t, d };
  }
  return best?.t || null;
}
