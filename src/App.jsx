import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import { SEED_LOGS } from "./shared.jsx";
import KioskView from "./KioskView.jsx";
import DriverView from "./DriverView.jsx";
import AdminView from "./AdminView.jsx";

export default function App() {
  const [dispatchLog, setDispatchLog] = useState([...SEED_LOGS]);
  const [pendingRequests, setPendingRequests] = useState([]);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
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
      <Routes>
        <Route
          path="/"
          element={
            <KioskView
              dispatchLog={dispatchLog}
              pendingRequests={pendingRequests}
              setPendingRequests={setPendingRequests}
            />
          }
        />
        <Route
          path="/driver"
          element={
            <DriverView
              pendingRequests={pendingRequests}
              setPendingRequests={setPendingRequests}
              dispatchLog={dispatchLog}
              setDispatchLog={setDispatchLog}
            />
          }
        />
        <Route path="/admin" element={<AdminView dispatchLog={dispatchLog} />} />
        {/* Unknown paths fall back to the kiosk — the default public-facing view */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
