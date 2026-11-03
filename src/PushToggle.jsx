import { useState, useEffect } from "react";
import { Bell, BellOff } from "lucide-react";
import { C, GR } from "./shared.jsx";
import { pushState, enablePush, disablePush, needsHomeScreen } from "./push.js";

// A small bell: turns phone notifications on or off for this device. Hidden
// when the browser can't do it or the server has no keys yet.
export default function PushToggle({ size = 34, style }) {
  const [state, setState] = useState("unavailable");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "unavailable") return null;

  const toggle = async () => {
    if (busy) return;
    if (state === "blocked") {
      setNote(
        "Notifications are blocked. Allow them in your browser's site settings.",
      );
      return;
    }
    if (state === "off" && needsHomeScreen()) {
      setNote(
        "On iPhone: tap Share, then 'Add to Home Screen', and open Gravitry from there.",
      );
      return;
    }
    setBusy(true);
    setNote("");
    try {
      if (state === "on") await disablePush();
      else await enablePush();
      setState(await pushState());
    } catch (e) {
      setNote(String(e.message || e));
    }
    setBusy(false);
  };

  return (
    <div style={{ position: "relative", ...style }}>
      <button
        onClick={toggle}
        title={
          state === "on"
            ? "Notifications are on (tap to turn off)"
            : "Turn on notifications"
        }
        aria-label="Notifications"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: state === "on" ? C.green : "rgba(255,255,255,0.95)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {state === "on" ? (
          <Bell size={15} color="#fff" />
        ) : (
          <BellOff size={15} color={C.muted} />
        )}
      </button>
      {note && (
        <div
          onClick={() => setNote("")}
          style={{
            position: "absolute",
            top: size + 6,
            right: 0,
            width: 220,
            background: "#fff",
            color: C.text,
            borderRadius: 10,
            padding: "8px 10px",
            fontFamily: GR,
            fontSize: 12,
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
            zIndex: 700,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
