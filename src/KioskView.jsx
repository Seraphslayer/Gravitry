import { useState, useEffect, useRef } from "react";
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
  Minimize2,
  Maximize2,
  Users,
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
import {
  getFares,
  createRequest,
  cancelRequest,
  getRequestById,
  getRequests,
  acceptViaNfc,
} from "./api.js";

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
const terminalIcon = makeDivIcon(C.green, false);
const selectedIcon = makeDivIcon(C.yellow, false);
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

function MapVisibilitySync({ trigger }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 260);
    return () => clearTimeout(t);
  }, [trigger, map]);
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
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [nfcNotice, setNfcNotice] = useState(null);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const lastAcceptedRef = useRef({ id: null, time: 0 });

  const originTerm = getTerm(KIOSK);
  const dests = TERMINALS.filter((t) => t.id !== KIOSK);
  const getFare = (o, d) => fares[`${o}-${d}`] ?? 0;
  const fare = dest ? getFare(KIOSK, dest.id) : 0;
  const kioskBusy = pendingQueue.some((r) => r.source === "kiosk");

  useEffect(() => {
    getFares()
      .then(setFares)
      .catch(() => setError("Could not load fares. Check your connection."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await getRequests({ status: "pending", origin: KIOSK });
        if (!cancelled) {
          const next = list
            .slice()
            .sort(
              (a, b) =>
                (a.source === "kiosk" ? 0 : 1) -
                  (b.source === "kiosk" ? 0 : 1) ||
                new Date(a.ts) - new Date(b.ts),
            );
          setPendingQueue(next);
        }
      } catch {
        /* keep last known list */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setSheetCollapsed(pinMode);
  }, [pinMode]);

  useEffect(() => {
    const FAST_THRESHOLD_MS = 50;
    const MIN_DIGITS = 6;
    const MAX_DIGITS = 20;

    const handleKeyDown = (e) => {
      const now = performance.now();
      const delta = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;
      const isDigit = e.key.length === 1 && e.key >= "0" && e.key <= "9";

      if (isDigit) {
        if (delta < FAST_THRESHOLD_MS && scanBufferRef.current.length > 0) {
          e.preventDefault();
          scanBufferRef.current += e.key;
        } else {
          scanBufferRef.current = e.key;
        }
        return;
      }

      if (e.key === "Enter") {
        const buffered = scanBufferRef.current;
        scanBufferRef.current = "";
        if (
          buffered.length >= MIN_DIGITS &&
          buffered.length <= MAX_DIGITS &&
          delta < FAST_THRESHOLD_MS
        ) {
          e.preventDefault();
          handleNfcTap(buffered);
        }
        return;
      }

      scanBufferRef.current = "";
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const handleNfcTap = async (nfcId) => {
    const now = Date.now();
    if (
      lastAcceptedRef.current.id === nfcId &&
      now - lastAcceptedRef.current.time < 5000
    ) {
      return;
    }
    lastAcceptedRef.current = { id: nfcId, time: now };
    try {
      const doc = await acceptViaNfc(nfcId, KIOSK);
      setNfcNotice({
        type: "success",
        text: `Driver ${doc.driver} accepted a trip to ${getTerm(doc.destination)?.short}`,
      });
    } catch (err) {
      setNfcNotice({
        type: "error",
        text:
          err.message?.replace(/^API .* failed: /, "") || "Card not recognized",
      });
    }
    setTimeout(() => setNfcNotice(null), 4000);
  };

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

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const [clat, clng] = COMPLEX_CENTER;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query,
        )}&limit=5&viewbox=${clng - 0.02},${clat + 0.02},${clng + 0.02},${clat - 0.02}&bounded=0`;
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
      const req = await createRequest(KIOSK, dest.id, fare, null, "kiosk");
      setMyRequestId(req._id);
      setStep("waiting");
    } catch (err) {
      const msg = err.message?.replace(/^API .* failed: /, "") || "";
      setError(
        /already waiting/i.test(msg)
          ? msg
          : "Couldn't send your request. Please try again.",
      );
    }
    setSubmitting(false);
  };

  const cancelWaiting = async () => {
    try {
      if (myRequestId) await cancelRequest(myRequestId);
    } catch {
      /* already accepted or gone - reset anyway */
    }
    reset();
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
      <div
        style={{
          position: "absolute",
          top: "calc(12px + var(--safe-top))",
          left: 12,
          zIndex: 600,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(11,45,72,0.92)",
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
          zIndex: 600,
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
          zIndex: 600,
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

      <button
        onClick={() => setSheetCollapsed((v) => !v)}
        title={sheetCollapsed ? "Show menu" : "Maximize map"}
        style={{
          position: "absolute",
          top: "calc(108px + var(--safe-top))",
          right: 12,
          zIndex: 600,
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
        {sheetCollapsed ? (
          <Maximize2 size={16} color={C.navy} />
        ) : (
          <Minimize2 size={16} color={C.navy} />
        )}
      </button>

      <button
        onClick={() => setShowQueue(true)}
        title="See who's waiting"
        style={{
          position: "absolute",
          top: "calc(156px + var(--safe-top))",
          right: 12,
          zIndex: 600,
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
        <Users size={16} color={C.navy} />
        {pendingQueue.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: C.danger,
              color: "#fff",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              fontFamily: GR,
            }}
          >
            {pendingQueue.length}
          </span>
        )}
      </button>

      {nfcNotice && (
        <div
          style={{
            position: "absolute",
            top: "calc(12px + var(--safe-top))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 700,
            background: nfcNotice.type === "success" ? C.green : C.danger,
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 12,
            fontFamily: GR,
            fontWeight: 600,
            fontSize: 12.5,
            boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
            maxWidth: "calc(100% - 24px)",
            textAlign: "center",
          }}
        >
          {nfcNotice.text}
        </div>
      )}

      <div className="kiosk-map-zone">
        <MapContainer
          center={COMPLEX_CENTER}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          zoomAnimation={false}
          fadeAnimation={false}
          markerZoomAnimation={false}
          inertia={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            updateWhenZooming={false}
            updateWhenIdle={true}
            keepBuffer={1}
          />
          <FlyToTerminal target={flyTarget} />
          <MapClickCatcher active={pinMode} onPick={pickLocation} />
          <MapVisibilitySync trigger={sheetCollapsed} />
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

        {pinMode && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              right: 12,
              zIndex: 400,
              background: "rgba(11,45,72,0.95)",
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

      <div
        className={`bottom-sheet${sheetCollapsed ? " sheet-collapsed" : ""}`}
      >
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

            {kioskBusy && (
              <div
                style={{
                  marginTop: 14,
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontFamily: IN,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                }}
              >
                A passenger is already waiting. A driver must tap their card to
                accept that ride before a new one can be requested.
              </div>
            )}
            <button
              onClick={() => setStep("select")}
              disabled={kioskBusy}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "18px 20px",
                borderRadius: 16,
                border: "none",
                background: kioskBusy ? C.surface : C.yellow,
                color: kioskBusy ? C.muted : C.navy,
                fontSize: "clamp(15px, 4vw, 17px)",
                fontWeight: 700,
                fontFamily: GR,
                cursor: kioskBusy ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: kioskBusy
                  ? "none"
                  : "0 6px 20px rgba(247,195,68,0.4)",
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
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: C.greenLight,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.green,
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {t.short}
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: GR,
                          fontWeight: 700,
                          fontSize: 13.5,
                          color: C.text,
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        style={{
                          fontFamily: IN,
                          fontSize: 11.5,
                          color: C.muted,
                        }}
                      >
                        Terminal {t.id}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 14,
                        color: C.green,
                      }}
                    >
                      ₱{getFare(KIOSK, t.id)}
                    </div>
                    <div
                      style={{ fontFamily: IN, fontSize: 10.5, color: C.muted }}
                    >
                      Official fare
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "fare" && dest && (
          <div>
            <h2
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 19,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Review Trip
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 12.5,
                color: C.muted,
                margin: "0 0 14px",
              }}
            >
              Confirm your destination details
            </p>

            <div
              style={{
                background: C.surface,
                borderRadius: 14,
                border: `1.5px solid ${C.border}`,
                padding: "14px 16px",
                marginBottom: 16,
              }}
            >
              <SlipRow
                label="From"
                value={originTerm.name}
                icon={<MapPin size={13} color={C.green} />}
              />
              <SlipRow
                label="To"
                value={dest.name}
                icon={<MapPin size={13} color={C.danger} />}
              />
              <SlipRow
                label="Official Fare"
                value={`₱${fare}`}
                accent
                icon={<Shield size={13} color={C.green} />}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setStep("select")}
                style={{
                  flex: 1,
                  padding: "14px",
                  borderRadius: 14,
                  border: `1.5px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                style={{
                  flex: 2,
                  padding: "14px",
                  borderRadius: 14,
                  border: "none",
                  background: C.yellow,
                  color: C.navy,
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? "Sending..." : "Confirm & Wait"}{" "}
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {step === "waiting" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: C.greenLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 14px",
              }}
            >
              <Truck size={28} color={C.green} />
            </div>
            <h2
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 18,
                color: C.text,
                margin: "0 0 6px",
              }}
            >
              Waiting for a driver to tap their card…
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 13,
                color: C.muted,
                margin: "0 0 16px",
                lineHeight: 1.4,
              }}
            >
              A driver must tap their NFC card on the reader to accept
            </p>

            <div
              style={{
                background: C.surface,
                borderRadius: 14,
                border: `1.5px solid ${C.border}`,
                padding: "12px 16px",
                marginBottom: 18,
                textAlign: "left",
              }}
            >
              <SlipRow
                label="Destination"
                value={dest?.short}
                icon={<MapPin size={13} color={C.danger} />}
              />
              <SlipRow
                label="Fare"
                value={`₱${fare}`}
                accent
                icon={<Shield size={13} color={C.green} />}
              />
              <SlipRow
                label="Status"
                value="Waiting for driver acceptance"
                mono
                icon={<Hash size={13} color={C.muted} />}
              />
            </div>

            <button
              onClick={cancelWaiting}
              style={{
                background: "transparent",
                border: `1.5px solid ${C.danger}`,
                color: C.danger,
                padding: "12px 24px",
                borderRadius: 12,
                fontFamily: GR,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Cancel Request
            </button>
          </div>
        )}

        {step === "success" && record && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: C.greenLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}
            >
              <CheckCircle size={28} color={C.green} />
            </div>
            <h2
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 18,
                color: C.text,
                margin: "0 0 4px",
              }}
            >
              Driver Assigned!
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 12.5,
                color: C.muted,
                margin: "0 0 16px",
              }}
            >
              Please proceed to your assigned tricycle.
            </p>

            <div
              style={{
                background: C.surface,
                borderRadius: 14,
                border: `1.5px solid ${C.border}`,
                padding: "14px 16px",
                marginBottom: 18,
                textAlign: "left",
              }}
            >
              <SlipRow
                label="Driver"
                value={record.driver || "Assigned Driver"}
                icon={<User size={13} color={C.green} />}
                accent
              />
              <SlipRow
                label="Tricycle Body No."
                value={record.bodyNo || "TR-001"}
                mono
                icon={<Truck size={13} color={C.muted} />}
              />
              <SlipRow
                label="Destination"
                value={getTerm(record.destination)?.name || dest?.name}
                icon={<MapPin size={13} color={C.danger} />}
              />
              <SlipRow
                label="Fare"
                value={`₱${record.fare || fare}`}
                accent
                icon={<Shield size={13} color={C.green} />}
              />
            </div>

            <button
              onClick={reset}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: 14,
                border: "none",
                background: C.green,
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(16,185,129,0.3)",
              }}
            >
              Done / Next Passenger
            </button>
          </div>
        )}
      </div>

      {showQueue && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 800,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setShowQueue(false)}
        >
          <div
            style={{
              background: C.white,
              width: "100%",
              maxWidth: 500,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              maxHeight: "80vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <h3
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 16,
                  margin: 0,
                  color: C.text,
                }}
              >
                Waiting Queue ({pendingQueue.length})
              </h3>
              <button
                onClick={() => setShowQueue(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: C.muted,
                }}
              >
                <X size={18} />
              </button>
            </div>
            {pendingQueue.length === 0 ? (
              <p
                style={{
                  fontFamily: IN,
                  fontSize: 13,
                  color: C.muted,
                  textAlign: "center",
                  padding: "20px 0",
                }}
              >
                No passengers currently waiting.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingQueue.map((r, idx) => (
                  <div
                    key={r._id || idx}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <span
                          style={{
                            fontFamily: GR,
                            fontWeight: 700,
                            fontSize: 13.5,
                            color: C.text,
                          }}
                        >
                          {getTerm(r.destination)?.name || r.destination}
                        </span>
                        {r.source === "kiosk" && (
                          <span
                            style={{
                              fontFamily: GR,
                              fontWeight: 700,
                              fontSize: 9.5,
                              color: C.navy,
                              background: C.yellow,
                              borderRadius: 6,
                              padding: "1px 6px",
                              marginLeft: 6,
                              textTransform: "uppercase",
                            }}
                          >
                            Kiosk
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontFamily: IN,
                          fontSize: 11.5,
                          color: C.muted,
                          marginTop: 2,
                        }}
                      >
                        Origin: {getTerm(r.origin)?.short || r.origin} ·{" "}
                        {fmtTime
                          ? fmtTime(r.ts)
                          : new Date(r.ts).toLocaleTimeString()}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 14,
                        color: C.green,
                      }}
                    >
                      ₱{r.fare}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
