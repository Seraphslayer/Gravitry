import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Share2, Truck, MapPin, Shield } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { C, GR, IN, pinIcon } from "./shared.jsx";
import { shareTrip, unshareTrip, getSharedTrip } from "./api.js";

const driverIcon = pinIcon(C.navy, true);
const pickupIcon = pinIcon(C.green, false);
const dropoffIcon = pinIcon(C.yellow, false);

// ── Passenger side: the "Share my trip" button ─────────────────────────────
// Makes a private link a family member can open (no app, no login) to follow
// the trip. Turning sharing off kills the link.
export function ShareTripButton({ rideId }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const share = async () => {
    setBusy(true);
    setNote("");
    try {
      const { token } = await shareTrip(rideId);
      const url = `${window.location.origin}/trip/${token}`;
      setLink(url);
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Follow my tricycle ride",
            text: "You can follow my tricycle ride here:",
            url,
          });
          return;
        } catch (e) {
          if (e?.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setNote("Link copied. Send it to someone you trust.");
      } catch {
        setNote("Copy this link and send it to someone you trust.");
      }
    } catch (e) {
      setNote(String(e.message || e).replace(/^API [^:]*failed: /, ""));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await unshareTrip(rideId);
      setLink("");
      setNote("Sharing is off. The link no longer works.");
    } catch (e) {
      setNote(String(e.message || e).replace(/^API [^:]*failed: /, ""));
    }
    setBusy(false);
  };
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={share}
        disabled={busy}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "11px 0",
          borderRadius: 12,
          border: `1.5px solid ${C.green}`,
          background: C.greenLight,
          color: C.greenDark,
          fontFamily: GR,
          fontWeight: 700,
          fontSize: 13.5,
          cursor: "pointer",
        }}
      >
        <Share2 size={16} />{" "}
        {link ? "Share the link again" : "Share my trip with family"}
      </button>
      {link && (
        <>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              fontFamily: "monospace",
              fontSize: 11.5,
            }}
          />
          <button
            onClick={stop}
            disabled={busy}
            style={{
              background: "none",
              border: "none",
              color: C.muted,
              fontFamily: IN,
              fontSize: 12,
              cursor: "pointer",
              padding: "6px 0",
              textDecoration: "underline",
            }}
          >
            Stop sharing
          </button>
        </>
      )}
      {note && (
        <p
          style={{
            fontFamily: IN,
            fontSize: 12,
            color: C.muted,
            margin: "6px 0 0",
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function Fit({ points }) {
  const map = useMap();
  const key = points
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join("|");
  useEffect(() => {
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
    else if (points.length > 1)
      map.fitBounds(
        points.map((p) => [p.lat, p.lng]),
        { padding: [40, 40], maxZoom: 17 },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

const STATUS_TEXT = (t) =>
  t.status === "completed"
    ? "The trip is finished. They arrived."
    : t.status === "cancelled"
      ? "The ride was cancelled."
      : t.status === "pending"
        ? "Waiting for a tricycle driver to accept."
        : t.pickedUpAt
          ? "On the way to the drop-off."
          : "The driver is on the way to pick them up.";

// ── Family side: the public page at /trip/<token> ─────────────────────────
export default function ShareTrip() {
  const { token } = useParams();
  const [trip, setTrip] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    let timer;
    const load = async () => {
      try {
        const t = await getSharedTrip(token);
        if (!alive) return;
        setTrip(t);
        setErr("");
        if (t.status === "completed" || t.status === "cancelled") return; // stop polling
      } catch (e) {
        if (!alive) return;
        const msg = String(e.message || e).replace(/^API [^:]*failed: /, "");
        setErr(msg);
        if (/expired|not valid/i.test(msg)) return; // no point retrying
      }
      timer = setTimeout(load, 5000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token]);

  const points = trip
    ? [
        trip.driverLocation,
        trip.pickedUpAt ? null : trip.pickup,
        trip.dropoff,
      ].filter(Boolean)
    : [];

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.surface,
      }}
    >
      <div
        style={{
          background: C.navy,
          color: "#fff",
          padding: "12px 16px",
          fontFamily: GR,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Truck size={18} color={C.yellow} /> Gravitry - Follow a ride
      </div>
      {err && !trip && (
        <div
          style={{
            padding: 24,
            fontFamily: GR,
            color: C.text,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 700 }}>{err}</p>
          <p style={{ fontFamily: IN, fontSize: 13, color: C.muted }}>
            Ask the passenger to send a new link.
          </p>
        </div>
      )}
      {!trip && !err && (
        <p style={{ padding: 24, fontFamily: IN, color: C.muted }}>
          Loading...
        </p>
      )}
      {trip && (
        <>
          <div style={{ flex: 1, minHeight: 200, position: "relative" }}>
            <MapContainer
              center={[14.35612, 120.91735]}
              zoom={15}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Fit points={points} />
              {trip.pickup && !trip.pickedUpAt && (
                <Marker
                  position={[trip.pickup.lat, trip.pickup.lng]}
                  icon={pickupIcon}
                >
                  <Popup>Pickup: {trip.pickup.label}</Popup>
                </Marker>
              )}
              {trip.dropoff && (
                <Marker
                  position={[trip.dropoff.lat, trip.dropoff.lng]}
                  icon={dropoffIcon}
                >
                  <Popup>Drop-off: {trip.dropoff.label}</Popup>
                </Marker>
              )}
              {trip.driverLocation && (
                <Marker
                  position={[trip.driverLocation.lat, trip.driverLocation.lng]}
                  icon={driverIcon}
                  zIndexOffset={1000}
                >
                  <Popup>The tricycle</Popup>
                </Marker>
              )}
            </MapContainer>
          </div>
          <div
            style={{
              background: "#fff",
              borderRadius: "18px 18px 0 0",
              padding: "16px 18px calc(16px + env(safe-area-inset-bottom))",
              boxShadow: "0 -6px 24px rgba(0,0,0,0.12)",
              position: "relative",
              zIndex: 500,
            }}
          >
            <div
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 16,
                color: C.text,
              }}
            >
              {trip.passengerFirstName
                ? `${trip.passengerFirstName}'s ride`
                : "A ride"}
            </div>
            <p
              style={{
                fontFamily: IN,
                fontSize: 13.5,
                color: C.text,
                margin: "4px 0 10px",
              }}
            >
              {STATUS_TEXT(trip)}
              {!trip.driverLocation &&
                trip.status === "dispatched" &&
                " (The driver's live location is not available right now.)"}
            </p>
            {trip.driver && (
              <div
                style={{
                  background: C.surface,
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontFamily: IN,
                  fontSize: 13,
                  color: C.text,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <Shield
                  size={16}
                  color={C.green}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  Driver <b>{trip.driver}</b>
                  <br />
                  Tricycle <b>{trip.unit}</b>, plate <b>{trip.plate}</b>
                </div>
              </div>
            )}
            {trip.dropoff?.label && (
              <p
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  fontFamily: IN,
                  fontSize: 12.5,
                  color: C.muted,
                  margin: "10px 0 0",
                }}
              >
                <MapPin size={14} /> Going to {trip.dropoff.label}
              </p>
            )}
            {err && (
              <p
                style={{
                  color: "#B91C1C",
                  fontFamily: IN,
                  fontSize: 12,
                  margin: "8px 0 0",
                }}
              >
                {err}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
