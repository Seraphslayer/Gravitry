import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { C, GR, IN, TERMINALS, getTerm, fmtTime, Logo } from "./shared.jsx";
import { getFares, createRequest, getRequestById, getRequests } from "./api.js";
import { useAuth } from "./AuthContext.jsx";

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

function AuthScreen({ initial = "welcome" }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState(initial); // welcome | login | signup
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
        minHeight: "100%",
        background: C.navy,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "20px calc(20px + var(--safe-right)) 20px calc(20px + var(--safe-left))",
      }}
    >
      <div
        style={{
          background: C.white,
          borderRadius: 20,
          padding: "28px 24px",
          width: "100%",
          maxWidth: 340,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}
        >
          <Logo size={30} dark />
        </div>
        <p
          style={{
            textAlign: "center",
            fontFamily: IN,
            fontSize: 12.5,
            color: C.muted,
            margin: "0 0 22px",
          }}
        >
          Official TODA dispatch · Verified drivers
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

        {mode === "welcome" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 12,
                border: "none",
                background: C.green,
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <LogIn size={16} /> Log In
            </button>
            <button
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 12,
                border: `1.5px solid ${C.green}`,
                background: "#fff",
                color: C.greenDark,
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <UserPlus size={16} /> Create Account
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("gv-guest"))}
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
        )}

        {mode === "login" && (
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
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
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
            <button
              type="button"
              onClick={() => setMode("welcome")}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: C.muted,
                fontFamily: IN,
                fontSize: 12.5,
                cursor: "pointer",
                marginTop: 6,
              }}
            >
              ← Back
            </button>
          </form>
        )}

        {mode === "signup" && (
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
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
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
            <button
              type="button"
              onClick={() => setMode("welcome")}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: C.muted,
                fontFamily: IN,
                fontSize: 12.5,
                cursor: "pointer",
                marginTop: 6,
              }}
            >
              ← Back
            </button>
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

function RideFlow({ passenger }) {
  const [step, setStep] = useState("origin"); // origin | destination | fare | waiting | success
  const [origin, setOrigin] = useState(null);
  const [dest, setDest] = useState(null);
  const [fares, setFares] = useState({});
  const [myRequestId, setMyRequestId] = useState(null);
  const [record, setRecord] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getFares()
      .then(setFares)
      .catch(() => setError("Could not load fares. Check your connection."));
  }, []);

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

  const fare = origin && dest ? (fares[`${origin.id}-${dest.id}`] ?? 0) : 0;

  const reset = () => {
    setStep("origin");
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
      setStep("waiting");
    } catch {
      setError("Couldn't send your request. Please try again.");
    }
    setSubmitting(false);
  };

  return (
    <div>
      {error && step !== "waiting" && (
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

      {step === "origin" && (
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TERMINALS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOrigin(t);
                  setStep("destination");
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
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

      {step === "destination" && origin && (
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TERMINALS.filter((t) => t.id !== origin.id).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setDest(t);
                  setStep("fare");
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
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                      style={{ color: C.muted, fontFamily: IN, fontSize: 12 }}
                    >
                      ₱{fares[`${origin.id}-${t.id}`] ?? "—"} official fare
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} color={C.muted} />
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep("origin")}
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

      {step === "fare" && origin && dest && (
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
            }}
          >
            <CheckCircle size={18} />{" "}
            {submitting ? "Sending…" : "Confirm & Request Trip"}
          </button>
          <button
            onClick={() => setStep("destination")}
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
        <div style={{ textAlign: "center", padding: "20px 0" }}>
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
              fontSize: 17,
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
            onClick={reset}
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
                fontSize: 17,
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
              <span style={{ fontWeight: 700, color: C.green, fontFamily: GR }}>
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
  );
}

export default function PassengerApp() {
  const { user, loading, logout } = useAuth();
  const [guestMode, setGuestMode] = useState(false);
  const [tab, setTab] = useState("ride"); // ride | history

  useEffect(() => {
    const onGuest = () => setGuestMode(true);
    window.addEventListener("gv-guest", onGuest);
    return () => window.removeEventListener("gv-guest", onGuest);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setGuestMode(false);
    setTab("ride");
  }, [logout]);

  if (loading) {
    return <div style={{ minHeight: "100%", background: C.navy }} />;
  }

  const isPassenger = user?.role === "passenger";

  if (!isPassenger && !guestMode) {
    return <AuthScreen />;
  }

  const passenger = isPassenger
    ? { id: user.passengerId, name: user.name }
    : null;

  return (
    <div
      style={{ minHeight: "100%", background: C.surface, overflowY: "auto" }}
    >
      <div
        style={{
          background: C.navy,
          padding: "calc(12px + var(--safe-top)) clamp(16px,4vw,24px) 12px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: isPassenger ? 12 : 0,
          }}
        >
          <Logo size={22} />
          {isPassenger ? (
            <button
              onClick={handleLogout}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: 20,
                padding: "6px 12px",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  color: "#fff",
                  fontFamily: GR,
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                {user.name}
              </span>
              <LogOut size={13} color="rgba(255,255,255,0.6)" />
            </button>
          ) : (
            <button
              onClick={() => setGuestMode(false)}
              style={{
                background: C.yellow,
                border: "none",
                borderRadius: 20,
                padding: "6px 14px",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 11.5,
                color: C.navy,
                cursor: "pointer",
              }}
            >
              Log In
            </button>
          )}
        </div>
        {isPassenger && (
          <div style={{ display: "flex", gap: 6 }}>
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
                  background: tab === key ? C.yellow : "rgba(255,255,255,0.08)",
                  color: tab === key ? C.navy : "rgba(255,255,255,0.7)",
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
      </div>

      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "18px clamp(16px,4vw,24px) calc(24px + var(--safe-bottom))",
        }}
      >
        {!isPassenger && (
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
        {tab === "ride" && <RideFlow passenger={passenger} />}
        {tab === "history" && isPassenger && (
          <HistoryTab passengerId={user.passengerId} />
        )}
      </div>
    </div>
  );
}
