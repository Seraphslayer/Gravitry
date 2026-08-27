import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import {
  User,
  Lock,
  Phone,
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
  Logo,
} from "./shared.jsx";
import { getFares, createRequest, getRequestById, getRequests } from "./api.js";
import { useAuth } from "./AuthContext.jsx";

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

function FlyToTerminal({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17, { duration: 0.6 });
  }, [target, map]);
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
  const { login, signup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState(null);
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

  const handleSignup = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await signup(username.trim(), password, name.trim(), phone.trim());
      onClose();
    } catch (err) {
      setError(
        err.message?.replace(/^API .* failed: /, "") ||
          "Could not create account.",
      );
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
          {mode === "login"
            ? "Log in to your account"
            : "Create a passenger account"}
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

        {mode === "login" ? (
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
        ) : (
          <form onSubmit={handleSignup}>
            <Field
              icon={<User size={15} color={C.muted} />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoComplete="name"
            />
            <Field
              icon={<Phone size={15} color={C.muted} />}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              autoComplete="tel"
            />
            <Field
              icon={<User size={15} color={C.muted} />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              autoComplete="username"
            />
            <Field
              icon={<Lock size={15} color={C.muted} />}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              autoComplete="new-password"
            />
            <Field
              icon={<Lock size={15} color={C.muted} />}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
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
              {submitting ? "Creating…" : "Create Account"}
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
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => onModeChange("login")}
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
                Log in
              </button>
            </p>
          </form>
        )}
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

function statusColor(s) {
  if (s === "completed")
    return { bg: "#D1FAE5", fg: "#065F46", label: "Completed" };
  if (s === "dispatched")
    return { bg: "#DBEAFE", fg: "#1E40AF", label: "Dispatched" };
  return { bg: "#FEF3C7", fg: "#92400E", label: "Pending" };
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 13,
                  color: C.text,
                }}
              >
                {getTerm(r.origin)?.short}
              </span>
              <ArrowRight size={12} color={C.muted} />
              <span
                style={{
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 13,
                  color: C.navy,
                }}
              >
                {getTerm(r.destination)?.short}
              </span>
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
          </div>
        );
      })}
    </div>
  );
}

export default function PassengerApp() {
  const { user, loading, logout } = useAuth();
  const [guestMode, setGuestMode] = useState(false);
  const [tab, setTab] = useState("ride"); // ride | history
  const [authMode, setAuthMode] = useState(null); // null | "login" | "signup"

  // Ride-flow state — lifted here so the map can fly to the selection
  const [flowStep, setFlowStep] = useState("origin"); // origin | destination | fare | waiting | success
  const [origin, setOrigin] = useState(null);
  const [dest, setDest] = useState(null);
  const [fares, setFares] = useState({});
  const [myRequestId, setMyRequestId] = useState(null);
  const [record, setRecord] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isPassenger = user?.role === "passenger";
  const passenger = isPassenger
    ? { id: user.passengerId, name: user.name }
    : null;

  useEffect(() => {
    getFares()
      .then(setFares)
      .catch(() => setError("Could not load fares. Check your connection."));
  }, []);

  useEffect(() => {
    if (flowStep !== "waiting" || !myRequestId) return;
    const tick = async () => {
      try {
        const doc = await getRequestById(myRequestId);
        if (doc.status !== "pending") {
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
  }, [flowStep, myRequestId]);

  const fare = origin && dest ? (fares[`${origin.id}-${dest.id}`] ?? 0) : 0;
  const flyTarget = dest || origin;

  const resetFlow = () => {
    setFlowStep("origin");
    setOrigin(null);
    setDest(null);
    setRecord(null);
    setMyRequestId(null);
    setError(null);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await createRequest(origin.id, dest.id, fare, passenger);
      setMyRequestId(r._id);
      setFlowStep("waiting");
    } catch {
      setError("Couldn't send your request. Please try again.");
    }
    setSubmitting(false);
  };

  const handleLogout = async () => {
    await logout();
    setGuestMode(false);
    setTab("ride");
    resetFlow();
  };

  const showWelcomePanel = !loading && !isPassenger && !guestMode;

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
          {TERMINALS.map((t) => (
            <Marker
              key={t.id}
              position={[t.lat, t.lng]}
              icon={
                t.id === origin?.id || t.id === dest?.id
                  ? selectedIcon
                  : terminalIcon
              }
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
          ) : guestMode ? (
            <button
              onClick={() => setAuthMode("login")}
              style={{
                background: C.yellow,
                border: "none",
                borderRadius: 20,
                padding: "7px 14px",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 11.5,
                color: C.navy,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              }}
            >
              Log In
            </button>
          ) : null}
        </div>
      </div>

      <div className="bottom-sheet">
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
              <button
                onClick={() => setGuestMode(true)}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  background: "transparent",
                  border: "none",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Continue as Guest
              </button>
            </div>
          </div>
        )}

        {!loading && (isPassenger || guestMode) && (
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

            {!isPassenger && guestMode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: 12,
                  padding: "10px 14px",
                  fontFamily: IN,
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                <Clock size={14} /> Browsing as guest — log in to save your ride
                history.
              </div>
            )}

            {(tab === "ride" || !isPassenger) && (
              <>
                {flowStep === "origin" && (
                  <div>
                    <h2
                      style={{
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 17,
                        color: C.text,
                        margin: "0 0 14px",
                      }}
                    >
                      Where are you now?
                    </h2>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {TERMINALS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setOrigin(t);
                            setFlowStep("destination");
                          }}
                          style={{
                            background: C.white,
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
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                            }}
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
                              }}
                            >
                              <MapPin size={16} color={C.green} />
                            </div>
                            <span
                              style={{
                                color: C.text,
                                fontFamily: GR,
                                fontWeight: 600,
                                fontSize: 14,
                              }}
                            >
                              {t.name}
                            </span>
                          </div>
                          <ChevronRight size={16} color={C.muted} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {flowStep === "destination" && origin && (
                  <div>
                    <h2
                      style={{
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 17,
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
                      From {origin.name}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {TERMINALS.filter((t) => t.id !== origin.id).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setDest(t);
                            setFlowStep("fare");
                          }}
                          style={{
                            background: C.white,
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
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                            }}
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
                                style={{
                                  color: C.muted,
                                  fontFamily: IN,
                                  fontSize: 12,
                                }}
                              >
                                ₱{fares[`${origin.id}-${t.id}`] ?? "—"} official
                                fare
                              </div>
                            </div>
                          </div>
                          <ChevronRight size={16} color={C.muted} />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setFlowStep("origin");
                        setOrigin(null);
                      }}
                      style={{
                        marginTop: 14,
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
                      ← Change pickup
                    </button>
                  </div>
                )}

                {flowStep === "fare" && origin && dest && (
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
                        {origin.short}
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
                      }}
                    >
                      <CheckCircle size={18} />{" "}
                      {submitting ? "Sending…" : "Confirm & Request Trip"}
                    </button>
                    <button
                      onClick={() => setFlowStep("destination")}
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
                      onClick={resetFlow}
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

      {authMode && (
        <AuthOverlay
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
        />
      )}
    </div>
  );
}
