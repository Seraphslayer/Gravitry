import { useState, useEffect, useRef, useCallback } from "react";
import OnScreenKeyboard from "./OnScreenKeyboard.jsx";
import KioskStaff from "./KioskStaff.jsx";
import LineStatus from "./LineStatus.jsx";
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
  BadgePercent,
  Wifi,
  Route,
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
  DISCOUNTS,
  DISCOUNT_KEYS,
  discountLabel,
  discountedFare,
  pinIcon,
  RouteLayer,
  terminalPlace,
  reverseGeocode,
  coordLabel,
  shortAddress,
  pickupLabel,
  dropoffLabel,
  fmtKm,
  useNotice,
} from "./shared.jsx";
import {
  getQuote,
  createRequest,
  cancelRequest,
  getRequestById,
  getRequests,
  acceptViaNfc,
} from "./api.js";

const terminalIcon = pinIcon(C.navy, false);
const droppedPinIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#DC2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

function FlyToPoint({ target }) {
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
// Leaflet computes tile layout based on its container's size at mount time.
// Since the map-zone's height changes whenever the sheet collapses/expands
// (it's the flexible one in the column layout), Leaflet needs to be told to
// recalculate on every such transition, or tiles render blank/offset.
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
        gap: 12,
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
          flexShrink: 0,
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
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const KIOSK = "T1";

export default function KioskView() {
  const [step, setStep] = useState("home"); // home | select | fare | waiting | success
  const [dest, setDest] = useState(null); // exact drop-off point { lat, lng, label }
  const [record, setRecord] = useState(null);
  const [myRequestId, setMyRequestId] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoteTry, setQuoteTry] = useState(0);
  // Discount the passenger says they qualify for ("student" | "senior" | "pwd"
  // or null). It is only a claim: the driver checks the ID in person and taps
  // their NFC card to confirm it.
  const [discountClaim, setDiscountClaim] = useState(null);

  const [query, setQuery] = useState("");
  const [showKb, setShowKb] = useState(false);
  const [staffCard, setStaffCard] = useState(null); // { nfcId, name } after an admin card tap
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState(null); // { lat, lng, label, resolving }
  const draftKey = useRef("");
  const [showSettings, setShowSettings] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useNotice(null);
  const [nfcNotice, setNfcNotice] = useNotice(null); // { type: "success" | "error", text }
  const [pendingQueue, setPendingQueue] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  // NFC keystroke-capture bookkeeping. The reader emulates a keyboard, so we
  // distinguish a card tap from a real human keypress by typing speed - the
  // reader sends characters far faster than anyone could type by hand.
  const scanBufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const lastAcceptedRef = useRef({ id: null, time: 0 });

  // No GPS on the kiosk: it is fixed at its own terminal, so the pickup point
  // is always known and passengers only choose where they are going.
  const originTerm = getTerm(KIOSK);
  const pickupPlace = terminalPlace(originTerm);

  const regularFare = quote?.regularFare ?? 0;
  const fare = discountClaim
    ? discountedFare(regularFare, quote?.discountPercent)
    : regularFare;

  // Passengers queue at the single kiosk: several rides may wait for a driver's
  // card tap (the server enforces the same limit). Each tap takes the oldest.
  const KIOSK_QUEUE_MAX = 5;
  const kioskWaiting = pendingQueue.filter((r) => r.source === "kiosk");
  const kioskBusy = kioskWaiting.length >= KIOSK_QUEUE_MAX; // queue full
  const myPosition =
    myRequestId != null
      ? kioskWaiting.findIndex((r) => r._id === myRequestId) + 1
      : 0;

  // Poll the pending queue for this terminal, so drivers standing at the
  // kiosk (or anyone checking) can see who's waiting - independent of
  // whether a passenger is mid-booking on this same screen right now.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await getRequests({ status: "pending", origin: KIOSK });
        if (!cancelled) {
          // Kiosk-created rides first, then oldest first within each group
          const next = list
            .slice()
            .sort(
              (a, b) =>
                (a.source === "kiosk" ? 0 : 1) -
                  (b.source === "kiosk" ? 0 : 1) ||
                new Date(a.ts) - new Date(b.ts),
            );
          setPendingQueue((prev) =>
            prev.length === next.length &&
            prev.every((r, i) => r._id === next[i]._id)
              ? prev
              : next,
          );
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

  // Collapse the bottom sheet down to just its handle whenever pin-drop mode
  // starts, so the map gets the screen room needed to place a precise pin -
  // and restore the sheet automatically once a pin is placed or cancelled.
  // The manual toggle button below still works freely outside of this.
  useEffect(() => {
    setSheetCollapsed(pinMode);
  }, [pinMode]);

  // Work out the road distance and fare once the drop-off point is chosen.
  useEffect(() => {
    if (step !== "fare" || !dest) return;
    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    getQuote(pickupPlace, dest)
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err.message
          ? err.message.replace(/^API .* failed: /, "")
          : "";
        setQuoteError(
          msg || "Couldn't work out the fare. Check your connection.",
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, dest, quoteTry]);

  // NFC card-tap capture. The reader is a keyboard-emulation USB device: it
  // "types" the card's digits and an Enter, extremely fast (much faster than
  // a human). We only treat a burst as a tap when the inter-key timing is
  // fast throughout - anything at normal typing speed is left completely
  // alone (e.g. the destination search box below still works normally).
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
          // Continuing a fast burst - almost certainly the reader, not a
          // person. Swallow the keystroke so it never lands in a focused
          // input, and keep collecting it.
          e.preventDefault();
          scanBufferRef.current += e.key;
        } else {
          // Either the very first character of a possible burst, or a slow
          // (human) keypress. We can't yet tell which - start a fresh
          // buffer but don't intercept the keystroke itself.
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

      // Any other key breaks a burst in progress.
      scanBufferRef.current = "";
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNfcTap = async (nfcId) => {
    const now = Date.now();
    if (
      lastAcceptedRef.current.id === nfcId &&
      now - lastAcceptedRef.current.time < 5000
    ) {
      return; // same card still sitting near the reader - ignore repeat reads
    }
    lastAcceptedRef.current = { id: nfcId, time: now };
    try {
      const doc = await acceptViaNfc(nfcId, KIOSK);
      if (doc.staffCard) {
        // Admin staff card: open the staff panel (it asks for the PIN).
        setStaffCard({ nfcId, name: doc.name });
        return;
      }
      if (doc.checkedIn) {
        // No ride was waiting, so the tap counted as attendance.
        setNfcNotice({
          type: "success",
          text: `${doc.driver} · ${doc.unit || ""} - nasa pila: #${doc.position} sa ${doc.lineLength} tricycle`,
        });
        return;
      }
      setNfcNotice({
        type: "success",
        text: `${doc.driver} · ${doc.unit || ""} ${doc.plate || ""} · ride to ${dropoffLabel(doc)} ${
          doc.status === "dispatched"
            ? "accepted - open your Driver app to go to the passenger"
            : "recorded"
        }${
          doc.discountApplied
            ? ` · ${discountLabel(doc.discountType)} discount applied`
            : ""
        }`,
      });
    } catch (err) {
      setNfcNotice({
        type: "error",
        text:
          err.message?.replace(/^API .* failed: /, "") || "Card not recognized",
      });
    }
  };

  // Poll for driver acceptance while waiting. A kiosk ride is recorded as
  // completed the moment the driver taps their card, so anything that is no
  // longer "pending" (other than a cancelled / expired request) means a driver
  // took it.
  useEffect(() => {
    if (step !== "waiting" || !myRequestId) return;
    const tick = async () => {
      try {
        const doc = await getRequestById(myRequestId);
        if (doc.status === "cancelled") {
          reset();
          setError("Your request timed out. Please request again.");
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Puts the exact point on the map right away, then looks up its address.
  const setDraftPoint = async (lat, lng, label = null) => {
    const lt = parseFloat(lat);
    const lg = parseFloat(lng);
    const key = `${lt},${lg}`;
    draftKey.current = key;
    setDraft({
      lat: lt,
      lng: lg,
      label: label || coordLabel(lt, lg),
      resolving: !label,
    });
    setPinMode(false);
    setResults([]);
    setQuery("");
    setShowKb(false);
    if (!label) {
      const addr = await reverseGeocode(lt, lg);
      if (draftKey.current === key) {
        setDraft((d) =>
          d && `${d.lat},${d.lng}` === key
            ? { ...d, label: addr || d.label, resolving: false }
            : d,
        );
      }
    }
  };

  // Stable function for the map click handler (see MapClickCatcher below).
  const setDraftPointRef = useRef(setDraftPoint);
  setDraftPointRef.current = setDraftPoint;
  const onMapPick = useCallback(
    (lat, lng) => setDraftPointRef.current(lat, lng),
    [],
  );

  const confirmDraft = () => {
    if (draft) {
      setDest({ lat: draft.lat, lng: draft.lng, label: draft.label });
      setStep("fare");
    }
  };

  const handleConfirm = async () => {
    if (!quote || !dest) return;
    setSubmitting(true);
    setError(null);
    try {
      const req = await createRequest({
        origin: KIOSK,
        destination: nearestTerminal(dest.lat, dest.lng).terminal.id,
        quoteToken: quote.quoteToken,
        source: "kiosk",
        discountClaim,
      });
      setMyRequestId(req._id);
      setStep("waiting");
    } catch (err) {
      const msg = err.message?.replace(/^API .* failed: /, "") || "";
      if (/quote|expired/i.test(msg)) {
        setError(msg);
        setQuoteTry((n) => n + 1);
      } else {
        setError(
          /queue is full|already waiting/i.test(msg)
            ? msg
            : "Couldn't send your request. Please try again.",
        );
      }
    }
    setSubmitting(false);
  };

  const reset = () => {
    setStep("home");
    setDest(null);
    setQuote(null);
    setQuoteError(null);
    setRecord(null);
    setMyRequestId(null);
    setDiscountClaim(null);
    setQuery("");
    setResults([]);
    setPinMode(false);
    draftKey.current = "";
    setDraft(null);
    setError(null);
  };

  // Cancel the waiting request for real, so the kiosk is free again and the
  // ride stops showing up in the queue.
  const cancelWaiting = async () => {
    try {
      if (myRequestId) await cancelRequest(myRequestId);
    } catch {
      /* already accepted or gone - reset anyway */
    }
    reset();
  };

  const showRoute =
    (step === "fare" || step === "waiting" || step === "success") && dest;

  return (
    <div className="kiosk-shell kiosk-big">
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

      <LineStatus terminal={KIOSK} />

      {staffCard && (
        <KioskStaff
          card={staffCard}
          terminal={KIOSK}
          onClose={() => setStaffCard(null)}
        />
      )}

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
          {step === "select" && <FlyToPoint target={draft} />}
          <MapClickCatcher active={pinMode} onPick={onMapPick} />
          <MapVisibilitySync trigger={sheetCollapsed} />

          {TERMINALS.map((t) => (
            <Marker key={t.id} position={[t.lat, t.lng]} icon={terminalIcon}>
              <Popup>{t.name}</Popup>
            </Marker>
          ))}

          {step === "select" && draft && (
            <Marker position={[draft.lat, draft.lng]} icon={droppedPinIcon} />
          )}
          {showRoute && (
            <RouteLayer
              pickup={pickupPlace}
              dropoff={dest}
              route={quote?.geometry}
            />
          )}
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
            {kioskWaiting.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  background: kioskBusy ? "#FEE2E2" : "#FEF3C7",
                  color: kioskBusy ? "#991B1B" : "#92400E",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontFamily: IN,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                }}
              >
                {kioskBusy
                  ? `The queue is full (${KIOSK_QUEUE_MAX} rides waiting for a driver). Please try again in a moment.`
                  : `${kioskWaiting.length} passenger${kioskWaiting.length === 1 ? " is" : "s are"} already waiting for a driver. You can still request a ride: drivers accept in order.`}
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
                <BadgePercent size={13} color={C.green} /> Student / Senior /
                PWD discount
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
                onFocus={() => setShowKb(true)}
                onClick={() => setShowKb(true)}
                inputMode="none"
                autoComplete="off"
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

            {showKb && (
              // The keys are already big; scale them back a little so the
              // whole keyboard fits on screen next to the search box.
              <div style={{ zoom: 0.78 }}>
                <OnScreenKeyboard
                  value={query}
                  onChange={setQuery}
                  onDone={() => setShowKb(false)}
                />
              </div>
            )}

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
                    onClick={() =>
                      setDraftPoint(r.lat, r.lon, shortAddress(r.display_name))
                    }
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

            {!draft && (
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

            {draft && (
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
                  Drop-off point — shown on the map
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "#fff",
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 14,
                        lineHeight: 1.3,
                      }}
                    >
                      {draft.resolving ? "Finding the address…" : draft.label}
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.45)",
                        fontFamily: "monospace",
                        fontSize: 10.5,
                        marginTop: 2,
                      }}
                    >
                      {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}
                    </div>
                  </div>
                  <button
                    onClick={confirmDraft}
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
                      flexShrink: 0,
                    }}
                  >
                    Use this
                  </button>
                </div>
                <button
                  onClick={() => {
                    draftKey.current = "";
                    setDraft(null);
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
              Or choose a terminal as the drop-off point:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TERMINALS.filter((t) => t.id !== KIOSK).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setDest(terminalPlace(t));
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
                draftKey.current = "";
                setDraft(null);
                setPinMode(false);
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
                background: C.surface,
                borderRadius: 14,
                padding: "12px 14px",
                border: `1px solid ${C.border}`,
                marginBottom: 14,
                fontFamily: IN,
                fontSize: 12.5,
                color: C.text,
              }}
            >
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: C.muted }}>Pickup: </span>
                {originTerm.name}
              </div>
              <div>
                <span style={{ color: C.muted }}>Drop-off: </span>
                {dest.label}
              </div>
            </div>

            {!quote && !quoteError && (
              <div
                style={{
                  background: C.navy,
                  borderRadius: 18,
                  padding: "30px 20px",
                  textAlign: "center",
                  marginBottom: 14,
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                Working out the route and fare…
              </div>
            )}

            {quoteError && (
              <div
                style={{
                  background: "#FEE2E2",
                  color: "#991B1B",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontFamily: IN,
                  fontSize: 12.5,
                  marginBottom: 14,
                }}
              >
                {quoteError}
                <div>
                  <button
                    onClick={() => setQuoteTry((n) => n + 1)}
                    style={{
                      marginTop: 8,
                      background: "#991B1B",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 12px",
                      fontFamily: GR,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            {quote && (
              <div
                style={{
                  background: C.navy,
                  borderRadius: 18,
                  padding: "22px 20px",
                  textAlign: "center",
                  marginBottom: 14,
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
                  {discountClaim
                    ? `${discountLabel(discountClaim)} Discount Fare`
                    : "TODA-Approved Official Fare"}
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
                    style={{
                      fontSize: "0.35em",
                      opacity: 0.5,
                      fontWeight: 400,
                    }}
                  >
                    .00
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    color: "rgba(255,255,255,0.7)",
                    fontFamily: IN,
                    fontSize: 12.5,
                  }}
                >
                  <Route size={13} />
                  {quote.estimated ? "About " : ""}
                  {fmtKm(quote.distanceMeters)} by road
                  {discountClaim
                    ? ` · regular ₱${regularFare}.00, 20% off`
                    : ""}
                </div>
                {quote.estimated && (
                  <div
                    style={{
                      marginTop: 6,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: IN,
                      fontSize: 11,
                    }}
                  >
                    The route service is busy, so this distance is an estimate.
                  </div>
                )}
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
            )}

            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 12,
                  color: C.text,
                  marginBottom: 6,
                }}
              >
                Discount (Student, Senior Citizen, PWD)
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  [null, "No discount"],
                  ...DISCOUNT_KEYS.map((k) => [k, DISCOUNTS[k].label]),
                ].map(([key, label]) => {
                  const on = discountClaim === key;
                  return (
                    <button
                      key={key || "none"}
                      onClick={() => setDiscountClaim(key)}
                      style={{
                        padding: "9px 14px",
                        borderRadius: 20,
                        border: `1.5px solid ${on ? C.green : C.border}`,
                        background: on ? C.greenLight : "#fff",
                        color: on ? C.greenDark : C.text,
                        fontFamily: GR,
                        fontWeight: 600,
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {discountClaim && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    marginTop: 10,
                    background: "#FEF3C7",
                    color: "#92400E",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontFamily: IN,
                    fontSize: 12,
                    lineHeight: 1.45,
                  }}
                >
                  <Wifi size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Show your {DISCOUNTS[discountClaim].idName} to the driver.
                    The driver taps their NFC card to confirm your ID and apply
                    the discount.
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleConfirm}
              disabled={submitting || !quote}
              style={{
                width: "100%",
                padding: "16px 0",
                borderRadius: 14,
                border: "none",
                background: submitting || !quote ? C.muted : C.green,
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: GR,
                cursor: submitting || !quote ? "default" : "pointer",
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
              Waiting for a driver to tap their card…
            </h2>
            <p
              style={{
                fontFamily: IN,
                fontSize: 12.5,
                color: C.muted,
                margin: "0 0 18px",
              }}
            >
              {discountClaim
                ? `Driver: check the passenger's ${DISCOUNTS[discountClaim].idName}, then tap your NFC card on the reader to confirm the ride and the discount.`
                : "A driver must tap their NFC card on the reader to accept your ride."}
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
                  fontFamily: GR,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 600, color: C.text }}>
                  {originTerm.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: 600,
                    color: C.navy,
                  }}
                >
                  <ArrowRight size={13} color={C.muted} /> {dest?.label}
                </div>
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
                  {discountClaim
                    ? `${discountLabel(discountClaim)} discount fare`
                    : "Official fare"}
                  {quote ? ` · ${fmtKm(quote.distanceMeters)}` : ""}
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
            {myPosition > 0 && (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 13,
                  color: C.navy,
                }}
              >
                {myPosition === 1
                  ? "You are next in line"
                  : `You are #${myPosition} in line`}
              </div>
            )}
            <button
              onClick={reset}
              style={{
                marginTop: 14,
                background: C.navy,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "11px 18px",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Done - next passenger
            </button>
            <div
              style={{
                fontFamily: IN,
                fontSize: 11.5,
                color: C.muted,
                marginTop: 6,
              }}
            >
              Your ride stays in the queue. The driver's name and plate flash on
              this screen when they tap their card. Note them down.
            </div>
            <button
              onClick={cancelWaiting}
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
                Ride Confirmed!
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
                icon={<MapPin size={13} />}
                label="Pickup"
                value={pickupLabel(record)}
              />
              <SlipRow
                icon={<MapPin size={13} />}
                label="Drop-off"
                value={dropoffLabel(record)}
              />
              {record.distanceMeters ? (
                <SlipRow
                  icon={<Route size={13} />}
                  label="Distance"
                  value={`${record.distanceEstimated ? "About " : ""}${fmtKm(record.distanceMeters)}`}
                />
              ) : null}
              {record.discountApplied && (
                <SlipRow
                  icon={<BadgePercent size={13} />}
                  label="Discount"
                  value={`${discountLabel(record.discountType)} (20% off)`}
                />
              )}
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
                    color: C.green,
                  }}
                >
                  ● Fares calculated by distance
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
                  v0.7.0
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQueue && (
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
          onClick={() => setShowQueue(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: "20px 20px 0 0",
              width: "100%",
              maxWidth: 480,
              padding: "18px 20px calc(20px + var(--safe-bottom))",
              maxHeight: "70vh",
              overflowY: "auto",
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
                Waiting at {originTerm.short}
              </h3>
              <button
                onClick={() => setShowQueue(false)}
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
                No one waiting right now.
              </p>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {pendingQueue.map((r, i) => {
                  const wait = Math.round(
                    (Date.now() - new Date(r.ts).getTime()) / 60000,
                  );
                  const claimed = r.discountClaim || r.discountType;
                  return (
                    <div
                      key={r._id}
                      style={{
                        background: i === 0 ? C.greenLight : C.surface,
                        borderRadius: 12,
                        padding: "12px 14px",
                        border: `1px solid ${i === 0 ? C.green : C.border}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 10,
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              fontFamily: GR,
                              fontWeight: 700,
                              fontSize: 13,
                              color: C.text,
                            }}
                          >
                            {r.source !== "kiosk" && r.pickup?.label
                              ? `${pickupLabel(r)} → `
                              : ""}
                            {dropoffLabel(r)}
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
                        </span>
                        <span
                          style={{
                            fontFamily: GR,
                            fontWeight: 700,
                            fontSize: 13,
                            color: C.green,
                            flexShrink: 0,
                          }}
                        >
                          {"\u20B1"}
                          {r.fare}.00
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
                          style={{
                            fontFamily: IN,
                            fontSize: 11,
                            color: C.muted,
                          }}
                        >
                          {wait <= 0 ? "Just now" : `${wait}m waiting`}
                          {r.distanceMeters
                            ? ` · ${fmtKm(r.distanceMeters)}`
                            : ""}
                          {claimed
                            ? ` · ${discountLabel(claimed)} discount${
                                r.discountPending ? " (check ID, then tap)" : ""
                              }`
                            : ""}
                        </span>
                        {i === 0 && (
                          <span
                            style={{
                              fontFamily: GR,
                              fontWeight: 700,
                              fontSize: 10.5,
                              color: C.greenDark,
                              textTransform: "uppercase",
                            }}
                          >
                            Next up
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p
              style={{
                fontSize: 11,
                color: C.muted,
                fontFamily: IN,
                margin: "14px 0 0",
                textAlign: "center",
              }}
            >
              Drivers: tap your card on the reader to accept the next waiting
              passenger. For a discount ride, check the passenger's ID first -
              your tap confirms the discount.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
