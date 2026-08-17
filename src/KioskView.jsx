import { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  MapPin,
  Shield,
  ChevronRight,
  CheckCircle,
  ArrowRight,
  User,
  Truck,
  Hash,
  Search,
  X,
  Crosshair,
  Settings,
} from "lucide-react";
import {
  C,
  GR,
  IN,
  TERMINALS,
  COMPLEX_CENTER,
  getTerm,
  fmtTime,
  TrikeIcon,
  nearestTerminal,
} from "./shared.jsx";
import { getFares, createRequest, getRequestById } from "./api.js";

function makeDivIcon(color, pulse = false) {
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
const terminalIcon = makeDivIcon(C.green, true);
const selectedIcon = makeDivIcon(C.yellow, true);
const droppedPinIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#DC2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function FlyToTerminal({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17, { duration: 0.6 });
  }, [target, map]);
  return null;
}
function MapClickCatcher({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function SlipRow({ label, value, icon, mono, accent }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: C.muted,
          fontSize: 12,
          fontFamily: IN,
        }}
      >
        {icon} {label}
      </div>
      <span
        style={{
          fontFamily: mono ? "monospace" : accent ? GR : IN,
          fontWeight: accent ? 700 : 500,
          fontSize: accent ? 16 : 13,
          color: accent ? C.green : C.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function KioskView() {
  const KIOSK = "T1";
  const [step, setStep] = useState("home"); // home | select | fare | waiting | success
  const [dest, setDest] = useState(null);
  const [record, setRecord] = useState(null);
  const [myRequestId, setMyRequestId] = useState(null);
  const [fares, setFares] = useState({});

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [droppedPin, setDroppedPin] = useState(null);
  const [snap, setSnap] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const originTerm = getTerm(KIOSK);
  const dests = TERMINALS.filter((t) => t.id !== KIOSK);
  const getFare = (o, d) => fares[`${o}-${d}`] ?? 0;
  const fare = dest ? getFare(KIOSK, dest.id) : 0;

  // Load fares from backend on mount
  useEffect(() => {
    getFares()
      .then(setFares)
      .catch(() => setError("Could not load fares. Check your connection."));
  }, []);

  // Poll for driver acceptance while waiting
  useEffect(() => {
    if (step !== "waiting" || !myRequestId) return;
    const tick = async () => {
      try {
        const doc = await getRequestById(myRequestId);
        if (doc.status !== "pending") {
          setRecord(doc);
          setStep("success");
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [step, myRequestId]);

  // Nominatim search
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const [clat, clng] = COMPLEX_CENTER;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&viewbox=${clng - 0.02},${clat + 0.02},${clng + 0.02},${clat - 0.02}&bounded=0`;
        const res = await fetch(url, { headers: { "Accept-Language": "en" } });
        setResults((await res.json()) || []);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 500);
    return () => clearTimeout(t);
  }, [query]);

  const pickLocation = (lat, lng) => {
    const lt = parseFloat(lat),
      lg = parseFloat(lng);
    setDroppedPin({ lat: lt, lng: lg });
    setSnap(nearestTerminal(lt, lg, KIOSK));
    setPinMode(false);
    setResults([]);
    setQuery("");
  };
  const confirmSnap = () => {
    if (snap?.terminal) {
      setDest(snap.terminal);
      setStep("fare");
    }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const req = await createRequest(KIOSK, dest.id, fare);
      setMyRequestId(req._id);
      setStep("waiting");
    } catch {
      setError("Couldn't send your request. Please try again.");
    }
    setSubmitting(false);
  };

  const reset = () => {
    setStep("home");
    setDest(null);
    setRecord(null);
    setMyRequestId(null);
    setQuery("");
    setResults([]);
    setPinMode(false);
    setDroppedPin(null);
    setSnap(null);
    setError(null);
  };
  const flyTarget = dest || originTerm;

  return (
    <div className="kiosk-shell">
      <div className="kiosk-map-zone">
        <MapContainer
          center={COMPLEX_CENTER}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FlyToTerminal target={flyTarget} />
          <MapClickCatcher active={pinMode} onPick={pickLocation} />
          {droppedPin && (
            <Marker
              position={[droppedPin.lat, droppedPin.lng]}
              icon={droppedPinIcon}
            />
          )}
          {TERMINALS.map((t) => (
            <Marker
              key={t.id}
              position={[t.lat, t.lng]}
              icon={t.id === KIOSK ? selectedIcon : terminalIcon}
            >
              <Popup>{t.name}</Popup>
            </Marker>
          ))}
        </MapContainer>

        <div
          style={{
            position: "absolute",
            top: "calc(12px + var(--safe-top))",
            left: 12,
            zIndex: 400,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(11,45,72,0.92)",
            backdropFilter: "blur(6px)",
            padding: "8px 14px",
            borderRadius: 30,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          }}
        >
          <TrikeIcon size={18} color={C.yellow} />
          <span
            style={{
              color: "#fff",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            GRAVITRY
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            top: "calc(12px + var(--safe-top))",
            right: 12,
            zIndex: 400,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255,255,255,0.95)",
            padding: "7px 12px",
            borderRadius: 20,
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: C.green,
            }}
          />
          <span
            style={{
              fontFamily: GR,
              fontWeight: 600,
              fontSize: 11,
              color: C.text,
            }}
            className="hide-xs"
          >
            {originTerm.short}
          </span>
        </div>

        <button
          onClick={() => setShowSettings(true)}
          style={{
            position: "absolute",
            top: "calc(60px + var(--safe-top))",
            right: 12,
            zIndex: 400,
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.95)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            cursor: "pointer",
          }}
        >
          <Settings size={17} color={C.navy} />
        </button>

        {pinMode && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              right: 12,
              zIndex: 400,
              background: "rgba(11,45,72,0.95)",
              backdropFilter: "blur(6px)",
              borderRadius: 14,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Crosshair size={16} color={C.yellow} />
              <span style={{ color: "#fff", fontFamily: IN, fontSize: 12.5 }}>
                Tap the map to drop a pin
              </span>
            </div>
            <button
              onClick={() => setPinMode(false)}
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "none",
                borderRadius: 8,
                padding: "5px 10px",
                color: "#fff",
                fontFamily: GR,
                fontSize: 11.5,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="bottom-sheet">
        <div className="sheet-handle" />

        {error && step !== "waiting" && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: IN,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {step === "home" && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <div>
                <h1
                  style={{
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: "clamp(18px, 5vw, 22px)",
                    color: C.text,
                    margin: 0,
                  }}
                >
                  Need a ride?
                </h1>
                <p
                  style={{
                    fontFamily: IN,
                    fontSize: 13,
                    color: C.muted,
                    margin: "2px 0 0",
                  }}
                >
                  Official TODA dispatch · Verified drivers
                </p>
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: C.greenLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Shield size={20} color={C.green} />
              </div>
            </div>
            <button
              onClick={() => setStep("select")}
              style={{
                width: "100%",
                marginTop: 18,
                padding: "18px 20px",
                borderRadius: 16,
                border: "none",
                background: C.yellow,
                color: C.navy,
                fontSize: "clamp(15px, 4vw, 17px)",
                fontWeight: 700,
                fontFamily: GR,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 6px 20px rgba(247,195,68,0.4)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MapPin size={20} /> Request a Tricycle
              </span>
              <ChevronRight size={20} />
            </button>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  color: C.muted,
                  fontFamily: IN,
                }}
              >
                <Shield size={13} color={C.green} /> Fare shown before trip
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  color: C.muted,
                  fontFamily: IN,
                }}
              >
                <User size={13} color={C.green} /> Driver ID verified
              </div>
            </div>
          </div>
        )}

        {step === "select" && (
          <div>
            <h2
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: "clamp(16px, 4.5vw, 19px)",
                color: C.text,
                margin: "0 0 2px",
              }}
            >
              Where are you going?
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 12.5,
                color: C.muted,
                margin: "0 0 14px",
              }}
            >
              From {originTerm.name}
            </p>

            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search
                size={16}
                color={C.muted}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search an address or place"
                style={{
                  width: "100%",
                  padding: "13px 36px",
                  borderRadius: 14,
                  border: `1.5px solid ${C.border}`,
                  fontFamily: IN,
                  fontSize: 14,
                  outline: "none",
                  background: C.surface,
                }}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                  }}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: C.muted,
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {searching && (
              <p
                style={{
                  fontSize: 12,
                  color: C.muted,
                  fontFamily: IN,
                  margin: "0 0 10px",
                }}
              >
                Searching…
              </p>
            )}
            {results.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginBottom: 14,
                }}
              >
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => pickLocation(r.lat, r.lon)}
                    style={{
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "10px 14px",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <MapPin
                      size={14}
                      color={C.muted}
                      style={{ flexShrink: 0 }}
                    />
                    <span
                      style={{
                        fontFamily: IN,
                        fontSize: 12.5,
                        color: C.text,
                        lineHeight: 1.3,
                      }}
                    >
                      {r.display_name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!snap && (
              <button
                onClick={() => setPinMode(true)}
                style={{
                  width: "100%",
                  marginBottom: 16,
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: `1.5px dashed ${C.green}`,
                  background: C.greenLight,
                  color: C.greenDark,
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Crosshair size={16} /> Drop a pin on the map instead
              </button>
            )}

            {snap?.terminal && (
              <div
                style={{
                  background: C.navy,
                  borderRadius: 14,
                  padding: "14px 16px",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontFamily: IN,
                    fontSize: 11,
                    marginBottom: 6,
                  }}
                >
                  Nearest terminal to your pin ({snap.distanceMeters}m away):
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: "#fff",
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 15,
                      }}
                    >
                      {snap.terminal.name}
                    </div>
                    <div
                      style={{
                        color: C.yellow,
                        fontFamily: GR,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      ₱{getFare(KIOSK, snap.terminal.id)} official fare
                    </div>
                  </div>
                  <button
                    onClick={confirmSnap}
                    style={{
                      background: C.yellow,
                      color: C.navy,
                      border: "none",
                      borderRadius: 10,
                      padding: "9px 16px",
                      fontFamily: GR,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Use this
                  </button>
                </div>
                <button
                  onClick={() => {
                    setSnap(null);
                    setDroppedPin(null);
                  }}
                  style={{
                    marginTop: 8,
                    background: "transparent",
                    border: "none",
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: IN,
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Try a different spot
                </button>
              </div>
            )}

            <p
              style={{
                fontSize: 11,
                color: C.muted,
                fontFamily: IN,
                margin: "0 0 8px",
              }}
            >
              Or pick a terminal directly:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dests.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setDest(t);
                    setStep("fare");
                  }}
                  style={{
                    background: C.surface,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 14,
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12 }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: C.greenLight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <MapPin size={16} color={C.green} />
                    </div>
                    <div>
                      <div
                        style={{
                          color: C.text,
                          fontFamily: GR,
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        style={{ color: C.muted, fontFamily: IN, fontSize: 12 }}
                      >
                        ₱{getFare(KIOSK, t.id)} official fare
                      </div>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    color={C.muted}
                    style={{ flexShrink: 0 }}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setStep("home");
                setQuery("");
                setResults([]);
                setSnap(null);
                setDroppedPin(null);
              }}
              style={{
                marginTop: 14,
                background: "transparent",
                border: "none",
                color: C.muted,
                fontFamily: IN,
                fontSize: 13.5,
                cursor: "pointer",
                padding: "8px 0",
                width: "100%",
              }}
            >
              ← Back
            </button>
          </div>
        )}

        {step === "fare" && dest && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginBottom: 16,
                fontFamily: IN,
                fontSize: 13,
              }}
            >
              <span style={{ color: C.text, fontWeight: 600 }}>
                {originTerm.short}
              </span>
              <ArrowRight size={14} color={C.muted} />
              <span style={{ color: C.green, fontWeight: 600 }}>
                {dest.short}
              </span>
            </div>
            <div
              style={{
                background: C.navy,
                borderRadius: 18,
                padding: "22px 20px",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  color: "rgba(247,195,68,0.6)",
                  fontFamily: GR,
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                TODA-Approved Official Fare
              </div>
              <div
                className="fare-display-amount"
                style={{
                  color: C.yellow,
                  fontFamily: GR,
                  fontWeight: 700,
                  lineHeight: 1,
                  fontSize: "clamp(48px, 14vw, 64px)",
                }}
              >
                ₱{fare}
                <span
                  style={{ fontSize: "0.35em", opacity: 0.5, fontWeight: 400 }}
                >
                  .00
                </span>
              </div>
              <div
                style={{
                  marginTop: 10,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: IN,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                }}
              >
                Government-mandated rate — drivers cannot charge more
              </div>
            </div>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "16px 0",
                borderRadius: 14,
                border: "none",
                background: submitting ? C.muted : C.green,
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: GR,
                cursor: submitting ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginBottom: 8,
                boxShadow: "0 4px 16px rgba(28,124,84,0.35)",
              }}
            >
              <CheckCircle size={18} />{" "}
              {submitting ? "Sending…" : "Confirm & Request Trip"}
            </button>
            <button
              onClick={() => setStep("select")}
              style={{
                background: "transparent",
                border: "none",
                color: C.muted,
                fontFamily: IN,
                fontSize: 13.5,
                cursor: "pointer",
                width: "100%",
                padding: "8px 0",
              }}
            >
              ← Change destination
            </button>
          </div>
        )}

        {step === "waiting" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div
              style={{
                position: "relative",
                width: 64,
                height: 64,
                margin: "0 auto 18px",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: "rgba(28,124,84,0.15)",
                  animation: "gv-pulse 1.6s ease-out infinite",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: C.greenLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Truck size={26} color={C.green} />
              </div>
            </div>
            <h2
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: "clamp(16px,4.5vw,19px)",
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Looking for a nearby driver…
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 12.5,
                color: C.muted,
                margin: "0 0 18px",
              }}
            >
              We'll notify you the moment a TODA driver accepts
            </p>
            <div
              style={{
                background: C.surface,
                borderRadius: 14,
                padding: "14px 16px",
                border: `1px solid ${C.border}`,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontFamily: GR,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 600, color: C.text }}>
                  {originTerm.short}
                </span>
                <ArrowRight size={13} color={C.muted} />
                <span style={{ fontWeight: 600, color: C.navy }}>
                  {dest?.short}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{ fontFamily: IN, fontSize: 11.5, color: C.muted }}
                >
                  Official fare
                </span>
                <span
                  style={{
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    color: C.green,
                  }}
                >
                  ₱{fare}.00
                </span>
              </div>
            </div>
            <button
              onClick={reset}
              style={{
                marginTop: 16,
                background: "transparent",
                border: "none",
                color: C.muted,
                fontFamily: IN,
                fontSize: 13,
                cursor: "pointer",
                padding: "8px 0",
              }}
            >
              Cancel request
            </button>
          </div>
        )}

        {step === "success" && record && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: C.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 10px",
                }}
              >
                <CheckCircle size={24} color="#fff" />
              </div>
              <h2
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: "clamp(16px,4.5vw,19px)",
                  color: C.text,
                  margin: "0 0 2px",
                }}
              >
                Tricycle Dispatched!
              </h2>
              <p
                style={{
                  fontFamily: IN,
                  fontSize: 12.5,
                  color: C.muted,
                  margin: 0,
                }}
              >
                Screenshot your safety record
              </p>
            </div>
            <div
              style={{
                background: C.surface,
                borderRadius: 14,
                padding: 16,
                border: `1px solid ${C.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 12,
                    color: C.navy,
                  }}
                >
                  Passenger Safety Record
                </span>
                <Shield size={16} color={C.green} />
              </div>
              <SlipRow
                icon={<User size={13} />}
                label="Driver"
                value={record.driver}
              />
              <SlipRow
                icon={<Truck size={13} />}
                label="Unit No."
                value={record.unit}
                mono
              />
              <SlipRow
                icon={<Hash size={13} />}
                label="Plate No."
                value={record.plate}
                mono
              />
              <SlipRow
                icon={<span style={{ fontSize: 12 }}>₱</span>}
                label="Fare"
                value={`₱${record.fare}.00`}
                accent
              />
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px dashed ${C.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: C.muted,
                  fontFamily: IN,
                }}
              >
                <span>
                  {record._id} · {fmtTime(record.ts)}
                </span>
                <span
                  style={{ fontWeight: 700, color: C.green, fontFamily: GR }}
                >
                  VERIFIED ✓
                </span>
              </div>
            </div>
            <button
              onClick={reset}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "13px 0",
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                color: C.muted,
                fontFamily: GR,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              New Request
            </button>
          </div>
        )}
      </div>

      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "20px 20px 0 0",
              width: "100%",
              maxWidth: 480,
              padding: "18px 20px calc(20px + var(--safe-bottom))",
            }}
          >
            <div className="sheet-handle" />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h3
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 16,
                  color: C.text,
                  margin: 0,
                }}
              >
                Kiosk Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: C.surface,
                  border: "none",
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <X size={15} color={C.muted} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  background: C.surface,
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontFamily: IN, fontSize: 13, color: C.muted }}>
                  Terminal
                </span>
                <span
                  style={{
                    fontFamily: GR,
                    fontWeight: 600,
                    fontSize: 13,
                    color: C.text,
                  }}
                >
                  {originTerm.name}
                </span>
              </div>
              <div
                style={{
                  background: C.surface,
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontFamily: IN, fontSize: 13, color: C.muted }}>
                  Backend
                </span>
                <span
                  style={{
                    fontFamily: GR,
                    fontWeight: 600,
                    fontSize: 13,
                    color: Object.keys(fares).length ? C.green : C.danger,
                  }}
                >
                  {Object.keys(fares).length ? "● Connected" : "● Unreachable"}
                </span>
              </div>
              <div
                style={{
                  background: C.surface,
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontFamily: IN, fontSize: 13, color: C.muted }}>
                  App Version
                </span>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12.5,
                    color: C.text,
                  }}
                >
                  v0.4.0
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
