import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";
import KioskView from "./KioskView.jsx";
import DriverView from "./DriverView.jsx";
import AdminView from "./AdminView.jsx";

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
      <Routes>
        <Route path="/" element={<KioskView />} />
        <Route path="/driver" element={<DriverView />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
