import { useState, useEffect, useRef, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  User,
  Lock,
  LogIn,
  UserPlus,
  LogOut,
  MapPin,
  ArrowRight,
  ChevronRight,
  CheckCircle,
  Clock,
  History,
  Shield,
  Truck,
  Hash,
  X,
  Search,
  Crosshair,
  Minimize2,
  Maximize2,
  BadgePercent,
  Route,
  Navigation,
  Star,
} from "lucide-react";
import {
  C,
  GR,
  IN,
  TERMINALS,
  COMPLEX_CENTER,
  fmtTime,
  TrikeIcon,
  Logo,
  nearestTerminal,
  useLiveLocation,
  myLocationIcon,
  discountLabel,
  pinIcon,
  RouteLayer,
  terminalPlace,
  reverseGeocode,
  coordLabel,
  shortAddress,
  pickupLabel,
  dropoffLabel,
  fmtKm,
  pickupPoint,
  dropoffPoint,
  toLatLngs,
  etaMinutes,
  remainingAhead,
  useLiveRoute,
  FitTo,
  driverMarkerIcon,
  SmoothMarkers,
  useNotice,
} from "./shared.jsx";
import {
  getQuote,
  createRequest,
  cancelRequest,
  rateRequest,
  getRequestById,
  getRequests,
  trackRequest,
} from "./api.js";
import { useAuth } from "./AuthContext.jsx";
import SignupFlow from "./SignupFlow.jsx";

const terminalIcon = pinIcon(C.navy, false);
const pickupIcon = pinIcon(C.green, true);
const dropoffPinIcon = pinIcon(C.yellow, true);
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

function Field({ icon, ...props }) {
  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      <span
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        {icon}
      </span>
      <input
        {...props}
        style={{
          width: "100%",
          padding: "12px 12px 12px 36px",
          borderRadius: 12,
          border: `1.5px solid ${C.border}`,
          fontFamily: IN,
          fontSize: 14,
          outline: "none",
        }}
      />
    </div>
  );
}

// ── Auth overlay — slides up over the map, doesn't replace it ──────────────
function AuthOverlay({ mode, onModeChange, onClose }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useNotice(null);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const me = await login(username.trim(), password);
      if (me.role !== "passenger") {
        setError(
          "This looks like a driver/admin account — try the Driver or Admin page instead.",
        );
      } else {
        onClose();
      }
    } catch {
      setError("Invalid username or password.");
    }
    setSubmitting(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11,45,72,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxWidth: 480,
          padding: "18px 22px calc(22px + var(--safe-bottom))",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div className="sheet-handle" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <Logo size={26} dark />
          <button
            onClick={onClose}
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
        <p
          style={{
            fontFamily: IN,
            fontSize: 12.5,
            color: C.muted,
            margin: "0 0 18px",
          }}
        >
          Log in to your account
        </p>

        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: IN,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <Field
            icon={<User size={15} color={C.muted} />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
          />
          <Field
            icon={<Lock size={15} color={C.muted} />}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 12,
              border: "none",
              background: submitting ? C.muted : C.green,
              color: "#fff",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 14,
              cursor: submitting ? "default" : "pointer",
              marginTop: 6,
            }}
          >
            {submitting ? "Signing in…" : "Log In"}
          </button>
          <p
            style={{
              textAlign: "center",
              fontFamily: IN,
              fontSize: 12.5,
              color: C.muted,
              margin: "14px 0 0",
            }}
          >
            No account?{" "}
            <button
              type="button"
              onClick={() => onModeChange("signup")}
              style={{
                background: "none",
                border: "none",
                color: C.green,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              Sign up
            </button>
          </p>
        </form>
      </div>
    </div>
  );
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

function statusColor(s) {
  if (s === "completed")
    return { bg: "#D1FAE5", fg: "#065F46", label: "Completed" };
  if (s === "dispatched")
    return { bg: "#DBEAFE", fg: "#1E40AF", label: "Dispatched" };
  if (s === "cancelled")
    return { bg: "#F3F4F6", fg: "#374151", label: "Cancelled" };
  return { bg: "#FEF3C7", fg: "#92400E", label: "Pending" };
}

// Star rating for a completed ride. Shows the saved rating if there is one,
// otherwise lets the passenger pick 1-5 stars (and write a short comment).
// compact = true: a small "Rate this ride" line that opens on tap (history).
function RatingBox({ ride, compact = false, onRated }) {
  const [saved, setSaved] = useState(ride.rating || null);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useNotice("");

  const row = (value, size, onPick) => (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onPick}
          onClick={() => onPick && onPick(n)}
          onMouseEnter={() => onPick && setHover(n)}
          onMouseLeave={() => onPick && setHover(0)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          style={{
            background: "none",
            border: "none",
            padding: 2,
            cursor: onPick ? "pointer" : "default",
          }}
        >
          <Star
            size={size}
            color={C.yellow}
            fill={n <= value ? C.yellow : "none"}
          />
        </button>
      ))}
    </div>
  );

  if (saved) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: IN,
          fontSize: 12,
          color: C.muted,
        }}
      >
        {row(saved.stars, compact ? 14 : 18, null)}
        <span>
          You rated this ride{saved.comment ? `: "${saved.comment}"` : ""}
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: C.navy,
          fontFamily: GR,
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Star size={13} color={C.yellow} fill={C.yellow} /> Rate this ride
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const doc = await rateRequest(ride._id, stars, comment.trim());
      setSaved(doc.rating);
      if (onRated) onRated(doc);
    } catch (e) {
      setErr(
        String(e.message || e).replace(/^API [^:]*failed: /, "") ||
          "Could not save your rating.",
      );
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: "14px 16px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: GR,
          fontWeight: 700,
          fontSize: 14,
          color: C.text,
          marginBottom: 2,
        }}
      >
        How was your ride{ride.driver ? ` with ${ride.driver}` : ""}?
      </div>
      <div
        style={{
          fontFamily: IN,
          fontSize: 11.5,
          color: C.muted,
          marginBottom: 8,
        }}
      >
        Your rating helps keep our drivers accountable.
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {row(hover || stars, 30, setStars)}
      </div>
      {stars > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Add a comment (optional)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              border: `1.5px solid ${C.border}`,
              fontFamily: IN,
              fontSize: 13,
              resize: "none",
              outline: "none",
            }}
          />
          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "12px 0",
              background: C.navy,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Sending..." : "Submit rating"}
          </button>
        </>
      )}
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: IN,
            fontSize: 12,
            marginTop: 8,
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ passengerId }) {
  const [rides, setRides] = useState(null);

  useEffect(() => {
    getRequests({ passengerId })
      .then(setRides)
      .catch(() => setRides([]));
  }, [passengerId]);

  if (rides === null) {
    return (
      <p
        style={{
          textAlign: "center",
          color: C.muted,
          fontFamily: IN,
          fontSize: 13,
          padding: 30,
        }}
      >
        Loading…
      </p>
    );
  }
  if (rides.length === 0) {
    return (
      <div
        style={{
          background: C.white,
          borderRadius: 14,
          padding: "28px 20px",
          textAlign: "center",
          border: `1px solid ${C.border}`,
        }}
      >
        <History size={22} color={C.muted} style={{ marginBottom: 8 }} />
        <p style={{ color: C.muted, fontFamily: IN, fontSize: 13, margin: 0 }}>
          No rides yet. Book your first trip!
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rides.map((r) => {
        const s = statusColor(r.status);
        return (
          <div
            key={r._id}
            style={{
              background: C.white,
              borderRadius: 14,
              padding: "14px 16px",
              border: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: C.muted,
                }}
              >
                {r._id}
              </span>
              <span
                style={{
                  background: s.bg,
                  color: s.fg,
                  borderRadius: 20,
                  padding: "2px 9px",
                  fontSize: 10.5,
                  fontWeight: 700,
                  fontFamily: GR,
                }}
              >
                {s.label}
              </span>
            </div>
            <div style={{ marginBottom: 6 }}>
              <div
                style={{
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 12.5,
                  color: C.text,
                }}
              >
                {pickupLabel(r)}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 12.5,
                  color: C.navy,
                }}
              >
                <ArrowRight size={12} color={C.muted} /> {dropoffLabel(r)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontFamily: IN, fontSize: 11, color: C.muted }}>
                {fmtTime(r.ts)}
                {r.distanceMeters ? ` · ${fmtKm(r.distanceMeters)}` : ""}
                {r.discountApplied
                  ? ` · ${discountLabel(r.discountType)} discount`
                  : ""}
              </span>
              <span
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 13,
                  color: C.green,
                }}
              >
                ₱{r.fare}.00
              </span>
            </div>
            {r.status === "completed" && r.driverId && (
              <div style={{ marginTop: 8 }}>
                <RatingBox ride={r} compact />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Location step — used for BOTH pickup and drop-off ─────────────────────
// The passenger picks an exact point on the map (their GPS position, a
// searched address, or a dropped pin). It is shown on the map with its real
// address, and the fare is worked out from these exact points - it is never
// snapped to the nearest terminal. Terminals are only offered as shortcuts.
function LocationStep({ kind, otherPlace, onPick, onBack }) {
  const isPickup = kind === "pickup";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState(null); // { lat, lng, label, isGeo, resolving }
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const draftKey = useRef("");

  // The sheet auto-collapses during pin mode, which hides the Cancel button
  // below (it's inside this sheet's content). The parent renders a floating
  // Cancel button over the map instead, which reaches back in via this event.
  useEffect(() => {
    const onCancel = () => setPinMode(false);
    window.addEventListener("gv-cancel-pin", onCancel);
    return () => window.removeEventListener("gv-cancel-pin", onCancel);
  }, []);

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
  const setDraftPoint = async (
    lat,
    lng,
    { geo = false, label = null } = {},
  ) => {
    const lt = parseFloat(lat);
    const lg = parseFloat(lng);
    const key = `${lt},${lg}`;
    draftKey.current = key;
    setDraft({
      lat: lt,
      lng: lg,
      label: label || coordLabel(lt, lg),
      isGeo: geo,
      resolving: !label,
    });
    setPinMode(false);
    setResults([]);
    setQuery("");
    setLocationError(null);
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

  // A stable function for the map bridge below. If it changed on every render,
  // the bridge would announce itself again on every render, forever.
  const setDraftPointRef = useRef(setDraftPoint);
  setDraftPointRef.current = setDraftPoint;
  const onMapPick = useCallback(
    (lat, lng) => setDraftPointRef.current(lat, lng),
    [],
  );

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(
        "Your browser doesn't support location access. Try search or drop a pin instead.",
      );
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraftPoint(pos.coords.latitude, pos.coords.longitude, { geo: true });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError(
            "Location access was denied. You can still search or drop a pin manually.",
          );
        } else if (err.code === err.TIMEOUT) {
          setLocationError(
            "Location took too long to find. Try again, or search/drop a pin instead.",
          );
        } else {
          setLocationError(
            "Couldn't get your location. Try search or drop a pin instead.",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const confirmDraft = () => {
    if (draft) onPick({ lat: draft.lat, lng: draft.lng, label: draft.label });
  };

  return (
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
        {isPickup ? "Where should we pick you up?" : "Where are you going?"}
      </h2>
      {!isPickup && otherPlace && (
        <p
          style={{
            fontFamily: IN,
            fontSize: 12.5,
            color: C.muted,
            margin: "0 0 14px",
          }}
        >
          Pickup: {otherPlace.label}
        </p>
      )}
      {isPickup && <div style={{ marginBottom: 14 }} />}

      {isPickup && !draft && (
        <button
          onClick={useMyLocation}
          disabled={locating}
          style={{
            width: "100%",
            marginBottom: 10,
            padding: "13px 16px",
            borderRadius: 14,
            border: "none",
            background: locating ? C.muted : C.navy,
            color: "#fff",
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 13.5,
            cursor: locating ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Crosshair size={16} color={C.yellow} />
          {locating ? "Finding your location…" : "Use My Current Location"}
        </button>
      )}

      {locationError && (
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
          {locationError}
        </div>
      )}

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
              onClick={() =>
                setDraftPoint(r.lat, r.lon, {
                  label: shortAddress(r.display_name),
                })
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
              <MapPin size={14} color={C.muted} style={{ flexShrink: 0 }} />
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

      {pinMode && (
        <div
          style={{
            background: C.navy,
            borderRadius: 14,
            padding: "12px 16px",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
            {isPickup ? "Pickup point" : "Drop-off point"}
            {draft.isGeo ? " (your location)" : ""} — shown on the map
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
        Or choose a terminal as the exact point:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TERMINALS.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(terminalPlace(t))}
            style={{
              background: C.surface,
              border: `1.5px solid ${C.border}`,
              borderRadius: 14,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: C.greenLight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <MapPin size={15} color={C.green} />
              </div>
              <div
                style={{
                  color: C.text,
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 13.5,
                }}
              >
                {t.name}
              </div>
            </div>
            <ChevronRight size={16} color={C.muted} style={{ flexShrink: 0 }} />
          </button>
        ))}
      </div>

      {onBack && (
        <button
          onClick={onBack}
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
      )}

      <PinMarkerSync
        droppedPin={draft}
        pinMode={pinMode}
        isGeo={!!draft?.isGeo}
        onMapPick={onMapPick}
      />
    </div>
  );
}

// Bridges this step's dropped-pin/pin-mode state up to the always-mounted map
// via a tiny event bus, since the map lives outside this component in the DOM tree.
function PinMarkerSync({ droppedPin, pinMode, isGeo, onMapPick }) {
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("gv-pin-state", {
        detail: {
          droppedPin: droppedPin
            ? { lat: droppedPin.lat, lng: droppedPin.lng }
            : null,
          pinMode,
          isGeo,
          onMapPick,
        },
      }),
    );
  }, [droppedPin, pinMode, isGeo, onMapPick]);
  return null;
}

export default function PassengerApp() {
  const { user, loading, logout, refresh } = useAuth();
  const [tab, setTab] = useState("ride"); // ride | history
  const [authMode, setAuthMode] = useState(null); // null | "login" | "signup"
  const [sheetCollapsed, setSheetCollapsed] = useState(false);

  // pickup | dropoff | fare | waiting | success
  const [flowStep, setFlowStep] = useState("pickup");
  const [pickup, setPickup] = useState(null); // exact point { lat, lng, label }
  const [dropoff, setDropoff] = useState(null); // exact point { lat, lng, label }
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoteTry, setQuoteTry] = useState(0);
  const [myRequestId, setMyRequestId] = useState(null);
  const [record, setRecord] = useState(null);
  const [trackInfo, setTrackInfo] = useState(null); // { request, driverLocation }
  const [trail, setTrail] = useState([]); // where the driver has driven with the passenger
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useNotice(null);

  // Persistent "you are here" GPS dot — always visible on the map, separate
  // from the one-shot "Use My Current Location" picker used to select a pickup.
  const { position: myPosition } = useLiveLocation();

  // Pin-drop state bridged up from LocationStep so the always-visible map can render it
  const [pinState, setPinState] = useState({
    droppedPin: null,
    pinMode: false,
    isGeo: false,
    onMapPick: null,
  });
  useEffect(() => {
    const onSync = (e) => setPinState(e.detail);
    window.addEventListener("gv-pin-state", onSync);
    return () => window.removeEventListener("gv-pin-state", onSync);
  }, []);
  useEffect(() => {
    // clear pin marker whenever we leave the pickup/drop-off steps
    if (flowStep !== "pickup" && flowStep !== "dropoff") {
      setPinState({
        droppedPin: null,
        pinMode: false,
        isGeo: false,
        onMapPick: null,
      });
    }
  }, [flowStep]);

  // Collapse the bottom sheet down to just its handle whenever pin-drop mode
  // starts, so the map gets the screen room needed to place a precise pin -
  // and restore the sheet automatically once a pin is placed or cancelled.
  // The manual toggle button below still works freely outside of this.
  useEffect(() => {
    setSheetCollapsed(pinState.pinMode);
  }, [pinState.pinMode]);

  const isPassenger = user?.role === "passenger";

  // The discount TODA staff approved on this account's ID (student / senior /
  // pwd), or null. The server applies it to the quote and the ride.
  const activeDiscount = isPassenger ? user.discountType || null : null;

  // While the account is pending, re-check its status now and then so the
  // banner disappears soon after staff approve it (no reload needed).
  useEffect(() => {
    if (user?.status !== "pending") return;
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [user?.status, refresh]);

  // Work out the road distance and fare as soon as both exact points are set.
  useEffect(() => {
    if (flowStep !== "fare" || !pickup || !dropoff) return;
    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    getQuote(pickup, dropoff)
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
  }, [flowStep, pickup, dropoff, quoteTry]);

  useEffect(() => {
    if (flowStep !== "waiting" || !myRequestId) return;
    const tick = async () => {
      try {
        const doc = await getRequestById(myRequestId);
        if (doc.status === "cancelled") {
          resetFlow();
          setError("Your request was cancelled. Please request again.");
          return;
        }
        if (doc.status === "dispatched") {
          // a driver accepted in the Driver app and is on the way
          setRecord(doc);
          setFlowStep("tracking");
        } else if (doc.status !== "pending") {
          // recorded straight away by an NFC card tap
          setRecord(doc);
          setFlowStep("success");
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep, myRequestId]);

  // Pick up where we left off if the page was reloaded mid-ride.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!isPassenger || resumedRef.current) return;
    resumedRef.current = true;
    getRequests({ passengerId: user.passengerId })
      .then((rides) => {
        const active = rides.find(
          (r) => r.status === "pending" || r.status === "dispatched",
        );
        if (!active) return;
        const pk = pickupPoint(active);
        const dp = dropoffPoint(active);
        if (!pk || !dp) return;
        setPickup({ lat: pk.lat, lng: pk.lng, label: pickupLabel(active) });
        setDropoff({ lat: dp.lat, lng: dp.lng, label: dropoffLabel(active) });
        setMyRequestId(active._id);
        setFlowStep(active.status === "pending" ? "waiting" : "tracking");
      })
      .catch(() => {});
  }, [isPassenger, user?.passengerId]);

  // While the driver is on the way, keep asking where they are.
  useEffect(() => {
    if (flowStep !== "tracking" || !myRequestId) return;
    const tick = async () => {
      try {
        const info = await trackRequest(myRequestId);
        if (info.request.status === "completed") {
          setRecord(info.request);
          setFlowStep("success");
          return;
        }
        if (info.request.status === "cancelled") {
          resetFlow();
          return;
        }
        setTrackInfo(info);
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep, myRequestId]);

  // The live picture of the driver coming to you (and later, the trip).
  const tracking = flowStep === "tracking";
  const trackReq = trackInfo?.request || record;
  const driverFix = tracking ? trackInfo?.driverLocation || null : null;
  const driverPoint = driverFix
    ? { lat: driverFix.lat, lng: driverFix.lng }
    : null;
  const pickedUp = tracking && !!trackReq?.pickedUpAt;
  // heading to the passenger first, then to the drop-off
  const liveRoute = useLiveRoute(
    driverPoint,
    tracking ? (pickedUp ? dropoff : pickup) : null,
  );
  const ahead =
    liveRoute && driverPoint
      ? remainingAhead(liveRoute.coords, driverPoint)
      : null;
  const driverArrived = tracking && !pickedUp && !!ahead && ahead.meters < 50;
  const nearDropoff = tracking && pickedUp && !!ahead && ahead.meters < 40;

  // Trail of where the driver has driven since picking you up.
  useEffect(() => {
    if (!pickedUp) {
      setTrail([]);
      return;
    }
    if (!driverPoint) return;
    setTrail((t) => {
      const lastPt = t[t.length - 1];
      if (
        lastPt &&
        Math.abs(lastPt[0] - driverPoint.lat) < 0.00008 &&
        Math.abs(lastPt[1] - driverPoint.lng) < 0.00008
      )
        return t;
      return [...t.slice(-300), [driverPoint.lat, driverPoint.lng]];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedUp, driverPoint?.lat, driverPoint?.lng]);

  // The terminal whose queue the ride joins: nearest to the pickup point. It
  // only decides which terminal's drivers see the ride - the fare uses the
  // exact points.
  const queueTerm = pickup
    ? nearestTerminal(pickup.lat, pickup.lng).terminal
    : null;

  const resetFlow = () => {
    setFlowStep("pickup");
    setPickup(null);
    setDropoff(null);
    setQuote(null);
    setQuoteError(null);
    setRecord(null);
    setTrackInfo(null);
    setTrail([]);
    setMyRequestId(null);
    setError(null);
  };

  // Cancel a waiting request for real, so drivers stop seeing it as pending.
  const cancelWaiting = async () => {
    try {
      if (myRequestId) await cancelRequest(myRequestId);
    } catch {
      /* already accepted or gone - reset anyway */
    }
    resetFlow();
  };

  const handlePickPickup = (place) => {
    setPickup(place);
    setFlowStep("dropoff");
  };
  const handlePickDropoff = (place) => {
    setDropoff(place);
    setFlowStep("fare");
  };

  const handleConfirm = async () => {
    if (!quote || !pickup || !dropoff) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await createRequest({
        origin: nearestTerminal(pickup.lat, pickup.lng).terminal.id,
        destination: nearestTerminal(dropoff.lat, dropoff.lng).terminal.id,
        quoteToken: quote.quoteToken,
        source: "app",
      });
      setMyRequestId(r._id);
      setFlowStep("waiting");
    } catch (err) {
      const msg = err.message
        ? err.message.replace(/^API .* failed: /, "")
        : "";
      if (/quote|expired/i.test(msg)) {
        setError(msg);
        setQuoteTry((n) => n + 1);
      } else {
        setError(
          /verif|account/i.test(msg)
            ? msg
            : "Couldn't send your request. Please try again.",
        );
      }
    }
    setSubmitting(false);
  };

  const handleLogout = async () => {
    await logout();
    setTab("ride");
    resetFlow();
  };

  const showWelcomePanel = !loading && !isPassenger;
  const canBook = user?.status !== "rejected";
  const inLocationStep = flowStep === "pickup" || flowStep === "dropoff";
  const showRoute = !inLocationStep && !tracking && pickup && dropoff;

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
          right: 60,
          zIndex: 600,
        }}
      >
        {isPassenger ? (
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(255,255,255,0.95)",
              border: "none",
              borderRadius: 20,
              padding: "7px 12px",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            }}
          >
            <span
              style={{
                color: C.text,
                fontFamily: GR,
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              {user.name}
            </span>
            <LogOut size={13} color={C.muted} />
          </button>
        ) : null}
      </div>

      <button
        onClick={() => setSheetCollapsed((v) => !v)}
        title={sheetCollapsed ? "Show menu" : "Maximize map"}
        style={{
          position: "absolute",
          top: "calc(12px + var(--safe-top))",
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

      <div className="kiosk-map-zone">
        <MapContainer
          center={COMPLEX_CENTER}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {inLocationStep && <FlyToPoint target={pinState.droppedPin} />}
          <MapClickCatcher
            active={inLocationStep && pinState.pinMode}
            onPick={(lat, lng) => pinState.onMapPick?.(lat, lng)}
          />
          <MapVisibilitySync trigger={sheetCollapsed} />

          {TERMINALS.map((t) => (
            <Marker key={t.id} position={[t.lat, t.lng]} icon={terminalIcon}>
              <Popup>{t.name}</Popup>
            </Marker>
          ))}

          {inLocationStep && pinState.droppedPin && (
            <Marker
              position={[pinState.droppedPin.lat, pinState.droppedPin.lng]}
              icon={pinState.isGeo ? myLocationIcon : droppedPinIcon}
            />
          )}
          {flowStep === "dropoff" && pickup && (
            <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
              <Popup>Pickup: {pickup.label}</Popup>
            </Marker>
          )}
          {showRoute && (
            <RouteLayer
              pickup={pickup}
              dropoff={dropoff}
              route={quote?.geometry}
            />
          )}
          {tracking && pickup && dropoff && (
            <>
              <SmoothMarkers />
              <FitTo
                points={[
                  driverPoint,
                  pickedUp ? null : pickup,
                  pickedUp ? dropoff : null,
                ]}
                fitKey={`${!!driverPoint}|${pickedUp}`}
              />
              {/* where the driver has driven with you */}
              {pickedUp && trail.length > 1 && (
                <Polyline
                  positions={trail}
                  pathOptions={{ color: "#9CA3AF", weight: 5, opacity: 0.9 }}
                />
              )}
              {/* live line from the driver to you (then to the drop-off):
                  shrinks as the driver gets closer */}
              {ahead && (
                <Polyline
                  positions={ahead.line}
                  pathOptions={{
                    color: pickedUp ? C.green : C.navy,
                    weight: 6,
                    opacity: 0.9,
                  }}
                />
              )}
              {!pickedUp && (
                <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
                  <Popup>Pickup: {pickup.label}</Popup>
                </Marker>
              )}
              <Marker
                position={[dropoff.lat, dropoff.lng]}
                icon={dropoffPinIcon}
              >
                <Popup>Drop-off: {dropoff.label}</Popup>
              </Marker>
              {driverPoint && (
                <Marker
                  position={[driverPoint.lat, driverPoint.lng]}
                  icon={driverMarkerIcon}
                  zIndexOffset={1000}
                >
                  <Popup>Your driver</Popup>
                </Marker>
              )}
            </>
          )}
          {myPosition && (
            <Marker
              position={[myPosition.lat, myPosition.lng]}
              icon={myLocationIcon}
            >
              <Popup>You are here</Popup>
            </Marker>
          )}
        </MapContainer>

        {tracking && (
          <div
            style={{
              position: "absolute",
              top: "calc(60px + var(--safe-top))",
              left: 12,
              zIndex: 400,
              display: "flex",
              alignItems: "center",
              gap: 7,
              background:
                driverArrived || nearDropoff
                  ? C.green
                  : "rgba(255,255,255,0.96)",
              color: driverArrived || nearDropoff ? "#fff" : C.text,
              padding: "8px 14px",
              borderRadius: 20,
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 12.5,
            }}
          >
            <Navigation
              size={14}
              color={driverArrived || nearDropoff ? "#fff" : C.green}
            />
            {nearDropoff
              ? "You've arrived"
              : driverArrived
                ? "Your driver has arrived"
                : ahead
                  ? `${fmtKm(ahead.meters)} ${pickedUp ? "to drop-off" : "away"} · ~${etaMinutes(ahead.meters)} min`
                  : "Finding your driver…"}
          </div>
        )}

        {inLocationStep && pinState.pinMode && (
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
              onClick={() =>
                window.dispatchEvent(new CustomEvent("gv-cancel-pin"))
              }
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

        {error && flowStep !== "waiting" && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: IN,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {loading && <div style={{ height: 120 }} />}

        {showWelcomePanel && (
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginTop: 18,
              }}
            >
              <button
                onClick={() => setAuthMode("login")}
                style={{
                  width: "100%",
                  padding: "15px 0",
                  borderRadius: 14,
                  border: "none",
                  background: C.green,
                  color: "#fff",
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 14.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 4px 16px rgba(28,124,84,0.3)",
                }}
              >
                <LogIn size={17} /> Log In
              </button>
              <button
                onClick={() => setAuthMode("signup")}
                style={{
                  width: "100%",
                  padding: "15px 0",
                  borderRadius: 14,
                  border: `1.5px solid ${C.green}`,
                  background: "#fff",
                  color: C.greenDark,
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 14.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <UserPlus size={17} /> Create Account
              </button>
            </div>
          </div>
        )}

        {!loading && isPassenger && (
          <div>
            {isPassenger && (
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[
                  ["ride", "Request a Ride"],
                  ["history", "My Rides"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 20,
                      border: "none",
                      background: tab === key ? C.navy : C.surface,
                      color: tab === key ? "#fff" : C.muted,
                      fontFamily: GR,
                      fontWeight: 600,
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {user.status === "pending" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontFamily: IN,
                  fontSize: 12,
                  marginBottom: 16,
                  lineHeight: 1.45,
                }}
              >
                <Clock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Temporary account. TODA staff are checking your ID and selfie,
                  and your account becomes permanent once they approve it.
                  {user.discountClaim &&
                    ` Your ${discountLabel(user.discountClaim)} discount starts once they approve your ID. Until then you pay the regular fare.`}
                </span>
              </div>
            )}
            {user.status === "rejected" && (
              <div
                style={{
                  background: "#FEE2E2",
                  color: "#991B1B",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontFamily: IN,
                  fontSize: 12,
                  marginBottom: 16,
                  lineHeight: 1.45,
                }}
              >
                <div>
                  Your verification was not approved
                  {user.rejectionReason ? ": " + user.rejectionReason : "."} You
                  cannot book rides until you resubmit your documents and TODA
                  staff approve them.
                </div>
                <button
                  onClick={() => setAuthMode("resubmit")}
                  style={{
                    marginTop: 10,
                    background: "#991B1B",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "9px 14px",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  Resubmit documents
                </button>
              </div>
            )}
            {activeDiscount && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: C.greenLight,
                  color: C.greenDark,
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontFamily: IN,
                  fontSize: 12,
                  marginBottom: 16,
                  lineHeight: 1.45,
                }}
              >
                <BadgePercent size={15} style={{ flexShrink: 0 }} />
                <span>
                  <strong>{discountLabel(activeDiscount)} discount</strong> is
                  active on your account. 20% off every ride, applied
                  automatically.
                </span>
              </div>
            )}
            {user.status === "verified" &&
              user.discountClaim &&
              !user.discountType && (
                <div
                  style={{
                    background: C.surface,
                    color: C.muted,
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontFamily: IN,
                    fontSize: 12,
                    marginBottom: 16,
                    lineHeight: 1.45,
                  }}
                >
                  TODA staff approved your account but did not approve a
                  discount, so you pay the regular fare.
                </div>
              )}

            {tab === "ride" && canBook && (
              <>
                {flowStep === "pickup" && (
                  <LocationStep kind="pickup" onPick={handlePickPickup} />
                )}

                {flowStep === "dropoff" && pickup && (
                  <LocationStep
                    kind="dropoff"
                    otherPlace={pickup}
                    onPick={handlePickDropoff}
                    onBack={() => {
                      setFlowStep("pickup");
                      setPickup(null);
                    }}
                  />
                )}

                {flowStep === "fare" && pickup && dropoff && (
                  <div>
                    <div
                      style={{
                        background: C.surface,
                        borderRadius: 14,
                        padding: "12px 14px",
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          fontFamily: IN,
                          fontSize: 12.5,
                          color: C.text,
                          marginBottom: 6,
                        }}
                      >
                        <MapPin
                          size={14}
                          color={C.green}
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
                        <span>
                          <span style={{ color: C.muted }}>Pickup: </span>
                          {pickup.label}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          fontFamily: IN,
                          fontSize: 12.5,
                          color: C.text,
                        }}
                      >
                        <MapPin
                          size={14}
                          color="#B7881A"
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
                        <span>
                          <span style={{ color: C.muted }}>Drop-off: </span>
                          {dropoff.label}
                        </span>
                      </div>
                    </div>

                    {!quote && !quoteError && (
                      <div
                        style={{
                          background: C.navy,
                          borderRadius: 18,
                          padding: "30px 20px",
                          textAlign: "center",
                          marginBottom: 16,
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
                          marginBottom: 16,
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
                          {quote.discountApplied
                            ? `${discountLabel(quote.discountType)} Discount Fare`
                            : "TODA-Approved Official Fare"}
                        </div>
                        <div
                          style={{
                            color: C.yellow,
                            fontFamily: GR,
                            fontWeight: 700,
                            lineHeight: 1,
                            fontSize: "clamp(48px, 14vw, 64px)",
                          }}
                        >
                          ₱{quote.fare}
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
                          {quote.discountApplied
                            ? ` · regular ₱${quote.regularFare}.00, 20% off`
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
                            The route service is busy, so this distance is an
                            estimate.
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

                    {queueTerm && (
                      <p
                        style={{
                          fontFamily: IN,
                          fontSize: 11.5,
                          color: C.muted,
                          margin: "0 0 12px",
                          textAlign: "center",
                        }}
                      >
                        Your request goes to the {queueTerm.short} driver queue.
                      </p>
                    )}

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
                      }}
                    >
                      <CheckCircle size={18} />{" "}
                      {submitting ? "Sending…" : "Confirm & Request Trip"}
                    </button>
                    <button
                      onClick={() => setFlowStep("dropoff")}
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
                      ← Change drop-off
                    </button>
                  </div>
                )}

                {flowStep === "waiting" && (
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
                    <button
                      onClick={cancelWaiting}
                      style={{
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

                {flowStep === "tracking" && trackReq && (
                  <div>
                    <div style={{ textAlign: "center", marginBottom: 14 }}>
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "50%",
                          background: C.navy,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 10px",
                        }}
                      >
                        <Navigation size={24} color={C.yellow} />
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
                        {nearDropoff
                          ? "You've arrived!"
                          : pickedUp
                            ? "On your way"
                            : driverArrived
                              ? "Your driver has arrived"
                              : "Your driver is on the way"}
                      </h2>
                      <p
                        style={{
                          fontFamily: IN,
                          fontSize: 12.5,
                          color: C.muted,
                          margin: 0,
                        }}
                      >
                        {ahead
                          ? `${fmtKm(ahead.meters)} ${pickedUp ? "to your drop-off" : "away"} · about ${etaMinutes(ahead.meters)} min`
                          : driverFix === null && !driverPoint
                            ? "Waiting for the driver's location…"
                            : ""}
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
                          Your Driver · check before boarding
                        </span>
                        <Shield size={16} color={C.green} />
                      </div>
                      <SlipRow
                        icon={<User size={13} />}
                        label="Driver"
                        value={trackReq.driver}
                      />
                      <SlipRow
                        icon={<Truck size={13} />}
                        label="Unit No."
                        value={trackReq.unit}
                        mono
                      />
                      <SlipRow
                        icon={<Hash size={13} />}
                        label="Plate No."
                        value={trackReq.plate}
                        mono
                      />
                      <SlipRow
                        icon={<MapPin size={13} />}
                        label="Drop-off"
                        value={dropoffLabel(trackReq)}
                      />
                      <SlipRow
                        icon={<span style={{ fontSize: 12 }}>₱</span>}
                        label="Fare"
                        value={`₱${trackReq.fare}.00`}
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
                          {trackReq._id} · {fmtTime(trackReq.ts)}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: C.green,
                            fontFamily: GR,
                          }}
                        >
                          VERIFIED ✓
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {flowStep === "success" && record && (
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
                        {record.recordedViaNfc
                          ? "Tricycle Dispatched!"
                          : "Trip Completed!"}
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
                          style={{
                            fontWeight: 700,
                            color: C.green,
                            fontFamily: GR,
                          }}
                        >
                          VERIFIED ✓
                        </span>
                      </div>
                    </div>
                    {isPassenger &&
                      record.passengerId &&
                      record.driverId &&
                      record.status === "completed" &&
                      !record.recordedViaNfc && (
                        <div style={{ marginTop: 12 }}>
                          <RatingBox ride={record} />
                        </div>
                      )}
                    <button
                      onClick={resetFlow}
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
              </>
            )}

            {tab === "history" && isPassenger && (
              <HistoryTab passengerId={user.passengerId} />
            )}
          </div>
        )}
      </div>

      {authMode === "login" && (
        <AuthOverlay
          mode="login"
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
        />
      )}
      {(authMode === "signup" || authMode === "resubmit") && (
        <SignupFlow
          resubmit={authMode === "resubmit"}
          onClose={() => setAuthMode(null)}
        />
      )}
    </div>
  );
}
