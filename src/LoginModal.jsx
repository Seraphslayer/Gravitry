import { useState } from "react";
import { Lock, User, LogIn } from "lucide-react";
import { C, GR, IN, Logo } from "./shared.jsx";
import { useAuth } from "./AuthContext.jsx";

export default function LoginModal({ role }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const label = role === "admin" ? "Admin Dashboard" : "Driver App";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const me = await login(username.trim(), password);
      if (role && me.role !== role) {
        setError(`This account isn't authorized for the ${label}.`);
      }
    } catch {
      setError("Invalid username or password.");
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
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
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
          Sign in to {label}
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

        <div style={{ position: "relative", marginBottom: 12 }}>
          <User
            size={15}
            color={C.muted}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
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

        <div style={{ position: "relative", marginBottom: 18 }}>
          <Lock
            size={15}
            color={C.muted}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <LogIn size={16} /> {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
