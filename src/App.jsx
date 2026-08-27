import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import KioskView from "./KioskView.jsx";
import DriverView from "./DriverView.jsx";
import AdminView from "./AdminView.jsx";
import LoginModal from "./LoginModal.jsx";
import PassengerApp from "./PassengerApp.jsx";
import { AuthProvider, useAuth } from "./AuthContext.jsx";

function AuthGate({ role, children }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div style={{ minHeight: "100%", background: "#0B2D48" }} />;
  }
  if (!user) {
    return <LoginModal role={role} />;
  }
  if (user.role !== role) {
    return (
      <div
        style={{
          minHeight: "100%",
          background: "#0B2D48",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 24,
            maxWidth: 320,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 13,
              color: "#1A1A1A",
              margin: "0 0 16px",
            }}
          >
            You're signed in as <strong>{user.name}</strong> ({user.role}),
            which can't access this page.
          </p>
          <button
            onClick={logout}
            style={{
              background: "#1C7C54",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 18px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty(
        "--vh",
        `${window.innerHeight * 0.01}px`,
      );
    };
    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);
    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
    };
  }, []);

  return (
    <div className="app-shell">
      <AuthProvider>
        <Routes>
          <Route path="/" element={<PassengerApp />} />
          <Route path="/kiosk" element={<KioskView />} />
          <Route
            path="/driver"
            element={
              <AuthGate role="driver">
                <DriverView />
              </AuthGate>
            }
          />
          <Route
            path="/admin"
            element={
              <AuthGate role="admin">
                <AdminView />
              </AuthGate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </div>
  );
}
