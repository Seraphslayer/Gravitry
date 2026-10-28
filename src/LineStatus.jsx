import { useState, useEffect } from "react";
import { C, GR, IN } from "./shared.jsx";
import { getQueue } from "./api.js";

// Kiosk: how many tricycles are lined up and how many passengers are waiting.
// Tap it to see the order of the line.
export default function LineStatus({ terminal }) {
  const [q, setQ] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getQueue(terminal);
        if (alive) setQ(r);
      } catch {
        /* keep last known */
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [terminal]);

  if (!q) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(12px + var(--safe-top))",
        left: 12,
        zIndex: 600,
        fontFamily: GR,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          background: "rgba(255,255,255,0.96)",
          border: "none",
          borderRadius: 20,
          padding: "8px 14px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          cursor: "pointer",
          fontWeight: 700,
          fontSize: 13,
          color: C.text,
        }}
      >
        <span>🛺 {q.drivers.length} sa pila</span>
        <span style={{ color: C.muted }}>·</span>
        <span>🧍 {q.passengers.total} naghihintay</span>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            background: "rgba(255,255,255,0.97)",
            borderRadius: 14,
            padding: "10px 14px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
            minWidth: 220,
          }}
        >
          {q.drivers.length === 0 ? (
            <div style={{ fontFamily: IN, fontSize: 12.5, color: C.muted }}>
              Walang tricycle sa pila. I-tap ang NFC card para pumila.
            </div>
          ) : (
            q.drivers.map((d) => (
              <div
                key={d.driverId}
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 13,
                  padding: "3px 0",
                  fontWeight: d.position === 1 ? 800 : 600,
                  color: d.position === 1 ? C.green : C.text,
                }}
              >
                <span>#{d.position}</span>
                <span>{d.name}</span>
                <span style={{ color: C.muted }}>{d.unit || ""}</span>
                {d.position === 1 && <span>← susunod</span>}
              </div>
            ))
          )}
          <div
            style={{
              fontFamily: IN,
              fontSize: 11.5,
              color: C.muted,
              marginTop: 6,
            }}
          >
            Pasaherong nasa terminal: {q.passengers.atTerminal} · app:{" "}
            {q.passengers.app}
          </div>
        </div>
      )}
    </div>
  );
}
