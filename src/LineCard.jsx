import { useState, useEffect, useCallback } from "react";
import {
  C,
  GR,
  IN,
  TERMINALS,
  getTerm,
  distanceMeters,
  useNotice,
} from "./shared.jsx";
import { getMyLine, joinLine, leaveLine } from "./api.js";

// Same radius the server uses (JOIN_RADIUS_METERS in api/_terminals.js).
const JOIN_RADIUS = 100;

// Driver app: join / leave the line at the terminal you are standing at.
export default function LineCard({ position }) {
  const [mine, setMine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useNotice("");

  const load = useCallback(async () => {
    try {
      setMine(await getMyLine());
    } catch {
      /* keep last known */
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 6000);
    return () => clearInterval(id);
  }, [load]);

  const near =
    position &&
    TERMINALS.map((t) => ({
      t,
      d: distanceMeters(position.lat, position.lng, t.lat, t.lng),
    }))
      .filter((x) => x.d <= JOIN_RADIUS)
      .sort((a, b) => a.d - b.d)[0]?.t;

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message?.replace(/^API .* failed: /, "") || "Failed");
    }
    setBusy(false);
  };

  if (!mine && !near) return null;
  const box = {
    background: mine ? C.greenLight : C.surface,
    border: `1px solid ${mine ? C.green : C.border}`,
    borderRadius: 12,
    padding: "10px 12px",
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontFamily: GR,
  };
  const btn = {
    border: "none",
    borderRadius: 10,
    padding: "9px 14px",
    fontFamily: GR,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  };

  return (
    <div>
      <div style={box}>
        {mine ? (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>
                #{mine.position ?? "-"} sa pila
              </div>
              <div style={{ fontFamily: IN, fontSize: 12, color: C.muted }}>
                {getTerm(mine.terminal)?.short || mine.terminal} ·{" "}
                {mine.lineLength} tricycle sa pila
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => run(leaveLine)}
              style={{
                ...btn,
                background: C.white,
                color: "#DC2626",
                border: "1px solid #DC2626",
              }}
            >
              Umalis
            </button>
          </>
        ) : (
          <>
            <div
              style={{ flex: 1, fontFamily: IN, fontSize: 12.5, color: C.text }}
            >
              Nasa <b>{near.short}</b> ka. Pumila para sa susunod na pasahero.
            </div>
            <button
              disabled={busy}
              onClick={() => run(() => joinLine(position.lat, position.lng))}
              style={{ ...btn, background: C.navy, color: "#fff" }}
            >
              Pumila
            </button>
          </>
        )}
      </div>
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: GR,
            fontSize: 12.5,
            marginBottom: 8,
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}
