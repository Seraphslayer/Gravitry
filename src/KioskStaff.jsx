import { useState, useEffect, useCallback } from "react";
import { X, Delete } from "lucide-react";
import { C, GR, IN, useNotice } from "./shared.jsx";
import {
  staffLogin,
  staffDrivers,
  staffAssign,
  staffCancel,
  staffCheckin,
  getRequests,
} from "./api.js";

const clean = (e) => e?.message?.replace(/^API .* failed: /, "") || "Failed";

const btn = {
  border: "none",
  borderRadius: 12,
  fontFamily: GR,
  fontWeight: 700,
  cursor: "pointer",
  touchAction: "manipulation",
};

// Kiosk staff panel: opened by tapping an admin staff card. Asks for the PIN,
// then lets staff hand a waiting ride to a driver (manual override), cancel it,
// or check a driver in by hand. Closes by itself when the token runs out.
export default function KioskStaff({ card, terminal, onClose }) {
  const [pin, setPin] = useState("");
  const [auth, setAuth] = useState(null); // { token, name, until }
  const [err, setErr] = useNotice("");
  const [msg, setMsg] = useNotice("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("rides");
  const [rides, setRides] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [pickFor, setPickFor] = useState(null); // ride being assigned
  const [now, setNow] = useState(Date.now());

  const submitPin = async (p) => {
    setBusy(true);
    try {
      const r = await staffLogin(card.nfcId, p);
      setAuth({
        token: r.token,
        name: r.name,
        until: Date.now() + r.expiresInSeconds * 1000,
      });
    } catch (e) {
      setErr(clean(e));
      setPin("");
    }
    setBusy(false);
  };

  const press = (d) => {
    if (busy || pin.length >= 8) return;
    setPin(pin + d);
  };

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const [r, d] = await Promise.all([
        getRequests({ status: "pending", origin: terminal }),
        staffDrivers(auth.token, terminal),
      ]);
      setRides(r);
      setDrivers(d);
    } catch (e) {
      setErr(clean(e));
    }
  }, [auth, terminal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    if (!auth) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [auth, load]);

  // countdown + auto-close
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (auth && now > auth.until) onClose();
  }, [now, auth, onClose]);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      setMsg(okText);
      setPickFor(null);
      await load();
    } catch (e) {
      setErr(clean(e));
    }
    setBusy(false);
  };

  const secsLeft = auth
    ? Math.max(0, Math.round((auth.until - now) / 1000))
    : 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        style={{
          background: C.white,
          borderRadius: 18,
          width: "100%",
          maxWidth: 460,
          maxHeight: "92vh",
          overflowY: "auto",
          padding: 16,
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
        >
          <b style={{ fontFamily: GR, fontSize: 16, color: C.text, flex: 1 }}>
            {auth ? `Staff: ${auth.name}` : `Hello, ${card.name}`}
          </b>
          {auth && (
            <span
              style={{
                fontFamily: IN,
                fontSize: 11.5,
                color: C.muted,
                marginRight: 10,
              }}
            >
              {Math.floor(secsLeft / 60)}:
              {String(secsLeft % 60).padStart(2, "0")}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              ...btn,
              background: "transparent",
              padding: 6,
              color: C.muted,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {err && (
          <div
            style={{
              color: "#B91C1C",
              fontFamily: GR,
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {err}
          </div>
        )}
        {msg && (
          <div
            style={{
              color: C.green,
              fontFamily: GR,
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            {msg}
          </div>
        )}

        {!auth && (
          <div>
            <p
              style={{
                fontFamily: IN,
                fontSize: 13,
                color: C.muted,
                margin: "0 0 10px",
              }}
            >
              Enter your PIN
            </p>
            <div
              style={{
                textAlign: "center",
                fontFamily: GR,
                fontSize: 28,
                letterSpacing: 8,
                minHeight: 40,
                marginBottom: 10,
                color: C.text,
              }}
            >
              {"•".repeat(pin.length) || " "}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  onClick={() => press(d)}
                  style={{
                    ...btn,
                    height: 56,
                    fontSize: 22,
                    background: C.surface,
                    color: C.text,
                  }}
                >
                  {d}
                </button>
              ))}
              <button
                onClick={() => setPin(pin.slice(0, -1))}
                aria-label="Backspace"
                style={{
                  ...btn,
                  height: 56,
                  background: C.surface,
                  color: C.text,
                }}
              >
                <Delete size={22} />
              </button>
              <button
                onClick={() => press("0")}
                style={{
                  ...btn,
                  height: 56,
                  fontSize: 22,
                  background: C.surface,
                  color: C.text,
                }}
              >
                0
              </button>
              <button
                disabled={busy || pin.length < 4}
                onClick={() => submitPin(pin)}
                style={{
                  ...btn,
                  height: 56,
                  fontSize: 15,
                  background: C.navy,
                  color: "#fff",
                  opacity: pin.length < 4 ? 0.5 : 1,
                }}
              >
                OK
              </button>
            </div>
          </div>
        )}

        {auth && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[
                ["rides", `Waiting rides (${rides.length})`],
                ["checkin", "Check-in"],
              ].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => {
                    setTab(k);
                    setPickFor(null);
                  }}
                  style={{
                    ...btn,
                    flex: 1,
                    padding: "10px 6px",
                    fontSize: 13,
                    background: tab === k ? C.navy : C.surface,
                    color: tab === k ? "#fff" : C.text,
                  }}
                >
                  {l}
                </button>
              ))}
            </div>

            {tab === "rides" && rides.length === 0 && (
              <p
                style={{
                  fontFamily: IN,
                  color: C.muted,
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                No rides are waiting.
              </p>
            )}
            {tab === "rides" &&
              rides.map((r) => (
                <div
                  key={r._id}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 10,
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontFamily: GR,
                      fontSize: 13.5,
                      color: C.text,
                      fontWeight: 700,
                    }}
                  >
                    {r._id} · ₱{r.fare}
                    {r.discountClaim ? ` · claims ${r.discountClaim}` : ""}
                  </div>
                  <div
                    style={{
                      fontFamily: IN,
                      fontSize: 12,
                      color: C.muted,
                      margin: "2px 0 8px",
                    }}
                  >
                    {r.source === "kiosk" ? "Kiosk" : "App"} · to{" "}
                    {r.destination}
                  </div>
                  {pickFor === r._id ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {drivers.filter((d) => d.eligible).length === 0 && (
                        <span
                          style={{
                            fontFamily: IN,
                            fontSize: 12.5,
                            color: C.muted,
                          }}
                        >
                          No driver can take a ride right now.
                        </span>
                      )}
                      {drivers
                        .filter((d) => d.eligible)
                        .sort(
                          (a, b) => Number(b.checkedIn) - Number(a.checkedIn),
                        )
                        .map((d) => (
                          <button
                            key={d.id}
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => staffAssign(auth.token, r._id, d.id),
                                `${r._id} assigned to ${d.name}`,
                              )
                            }
                            style={{
                              ...btn,
                              textAlign: "left",
                              padding: "12px 14px",
                              background: C.surface,
                              color: C.text,
                              fontSize: 14,
                            }}
                          >
                            {d.name} · {d.unit || "-"}
                            {d.checkedIn && (
                              <span
                                style={{
                                  color: C.green,
                                  marginLeft: 8,
                                  fontSize: 12,
                                }}
                              >
                                ✓ here today
                              </span>
                            )}
                          </button>
                        ))}
                      <button
                        onClick={() => setPickFor(null)}
                        style={{
                          ...btn,
                          padding: 8,
                          background: "transparent",
                          color: C.muted,
                          fontSize: 13,
                        }}
                      >
                        Back
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setPickFor(r._id)}
                        style={{
                          ...btn,
                          flex: 1,
                          padding: "11px 8px",
                          background: C.navy,
                          color: "#fff",
                          fontSize: 13.5,
                        }}
                      >
                        Choose driver
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Cancel ${r._id}?`))
                            run(
                              () => staffCancel(auth.token, r._id),
                              `${r._id} cancelled`,
                            );
                        }}
                        style={{
                          ...btn,
                          padding: "11px 12px",
                          background: C.white,
                          color: "#DC2626",
                          border: "1px solid #DC2626",
                          fontSize: 13.5,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}

            {tab === "checkin" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p
                  style={{
                    fontFamily: IN,
                    fontSize: 12.5,
                    color: C.muted,
                    margin: "0 0 4px",
                  }}
                >
                  For a driver who can't tap their card. Marks them present
                  today.
                </p>
                {drivers.map((d) => (
                  <button
                    key={d.id}
                    disabled={busy || d.checkedIn || d.expired.length > 0}
                    onClick={() =>
                      run(
                        () => staffCheckin(auth.token, d.id, terminal),
                        `${d.name} checked in`,
                      )
                    }
                    style={{
                      ...btn,
                      textAlign: "left",
                      padding: "12px 14px",
                      background: C.surface,
                      color: C.text,
                      fontSize: 14,
                      opacity: d.checkedIn || d.expired.length ? 0.55 : 1,
                    }}
                  >
                    {d.name} · {d.unit || "-"}
                    {d.checkedIn && (
                      <span
                        style={{ color: C.green, marginLeft: 8, fontSize: 12 }}
                      >
                        ✓ present
                      </span>
                    )}
                    {d.expired.length > 0 && (
                      <span
                        style={{
                          color: "#DC2626",
                          marginLeft: 8,
                          fontSize: 12,
                        }}
                      >
                        {d.expired.join(" + ")} expired
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
