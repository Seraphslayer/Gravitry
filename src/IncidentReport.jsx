import { useState } from "react";
import { ShieldAlert, X, Phone, CheckCircle } from "lucide-react";
import { C, GR, IN, useNotice } from "./shared.jsx";
import { createReport } from "./api.js";

// What can be reported, per role (keep in sync with api/reports.js).
const CATEGORIES = {
  passenger: [
    ["reckless_driving", "Reckless driving"],
    ["overcharging", "Overcharging / wrong fare"],
    ["rude_behavior", "Rude or unsafe behavior"],
    ["harassment", "Harassment"],
    ["accident", "Accident"],
    ["lost_item", "Lost item"],
    ["other", "Other"],
  ],
  driver: [
    ["rude_passenger", "Rude or unsafe passenger"],
    ["refused_to_pay", "Refused to pay"],
    ["harassment", "Harassment"],
    ["accident", "Accident"],
    ["vehicle_problem", "Vehicle problem"],
    ["other", "Other"],
  ],
};

// The phone's position right now, or null if it can't be had quickly.
function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 },
    );
  });
}

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 10,
  border: `1.5px solid ${C.border}`,
  fontFamily: IN,
  fontSize: 13.5,
  outline: "none",
  background: "#fff",
};

// Floating SOS button + the sheet it opens: a one-tap emergency alert and an
// incident report form. role = "passenger" | "driver". rideId (optional) is the
// ride in progress, so staff see who and where. style positions the button.
export default function IncidentButton({ role, rideId, style }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(null); // "sos" | "incident" | null
  const [err, setErr] = useNotice("");
  const [done, setDone] = useState(null); // { kind, id }

  const close = () => {
    setOpen(false);
    setDone(null);
    setErr("");
    setCategory("");
    setDescription("");
  };

  const send = async (kind) => {
    setBusy(kind);
    setErr("");
    try {
      const pos = await currentPosition();
      const r = await createReport({
        kind,
        ...(kind === "incident"
          ? { category, description: description.trim() }
          : {}),
        ...(rideId ? { requestId: rideId } : {}),
        ...(pos ? pos : {}),
      });
      setDone({ kind, id: r.id, located: !!pos });
    } catch (e) {
      setErr(
        String(e.message || e).replace(/^API [^:]*failed: /, "") ||
          "Could not send. If you are in danger, call 911.",
      );
    }
    setBusy(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="SOS / Report an incident"
        aria-label="SOS or report an incident"
        style={{
          position: "absolute",
          zIndex: 650,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "#DC2626",
          color: "#fff",
          border: "2px solid #fff",
          borderRadius: 20,
          padding: "7px 12px",
          fontFamily: GR,
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: 0.5,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(220,38,38,0.5)",
          ...style,
        }}
      >
        <ShieldAlert size={15} /> SOS
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              width: "100%",
              maxWidth: 480,
              maxHeight: "92vh",
              overflowY: "auto",
              borderRadius: "20px 20px 0 0",
              padding: "18px 18px calc(18px + env(safe-area-inset-bottom))",
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
                  fontWeight: 800,
                  fontSize: 17,
                  color: C.text,
                }}
              >
                {done ? "Report sent" : "SOS / Report an incident"}
              </span>
              <button
                onClick={close}
                aria-label="Close"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <X size={20} color={C.muted} />
              </button>
            </div>

            {done ? (
              <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                <CheckCircle size={44} color={C.green} />
                <p
                  style={{
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 15,
                    color: C.text,
                    margin: "10px 0 4px",
                  }}
                >
                  {done.kind === "sos"
                    ? "Your SOS was sent to TODA staff"
                    : "Thank you, your report was sent"}
                </p>
                <p
                  style={{
                    fontFamily: IN,
                    fontSize: 12.5,
                    color: C.muted,
                    margin: "0 0 12px",
                    lineHeight: 1.5,
                  }}
                >
                  Reference <b>{done.id}</b>.{" "}
                  {done.kind === "sos"
                    ? done.located
                      ? "Your location was shared. "
                      : "We could not get your location, so tell staff where you are. "
                    : "TODA staff will review it. "}
                  {done.kind === "sos" && "If you are in danger, call 911 now."}
                </p>
                {done.kind === "sos" && (
                  <a
                    href="tel:911"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "#DC2626",
                      color: "#fff",
                      textDecoration: "none",
                      borderRadius: 12,
                      padding: "12px 20px",
                      fontFamily: GR,
                      fontWeight: 800,
                      fontSize: 14,
                      marginBottom: 12,
                    }}
                  >
                    <Phone size={16} /> Call 911
                  </a>
                )}
                <div>
                  <button
                    onClick={close}
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "11px 24px",
                      fontFamily: GR,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                      color: C.text,
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1.5px solid #FCA5A5",
                    borderRadius: 14,
                    padding: "14px 14px 12px",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontFamily: GR,
                      fontWeight: 800,
                      fontSize: 14,
                      color: "#991B1B",
                      marginBottom: 4,
                    }}
                  >
                    Emergency?
                  </div>
                  <p
                    style={{
                      fontFamily: IN,
                      fontSize: 12.5,
                      color: "#7F1D1D",
                      margin: "0 0 10px",
                      lineHeight: 1.45,
                    }}
                  >
                    This alerts TODA staff right away and shares your location
                    {rideId ? " and your current ride" : ""}.
                  </p>
                  <button
                    onClick={() => send("sos")}
                    disabled={!!busy}
                    style={{
                      width: "100%",
                      padding: "15px 0",
                      background: "#DC2626",
                      color: "#fff",
                      border: "none",
                      borderRadius: 12,
                      fontFamily: GR,
                      fontWeight: 800,
                      fontSize: 16,
                      letterSpacing: 0.5,
                      cursor: "pointer",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === "sos" ? "Sending SOS..." : "SEND SOS"}
                  </button>
                  <a
                    href="tel:911"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      marginTop: 8,
                      fontFamily: GR,
                      fontWeight: 700,
                      fontSize: 13,
                      color: "#991B1B",
                      textDecoration: "none",
                    }}
                  >
                    <Phone size={14} /> Or call 911
                  </a>
                </div>

                <div
                  style={{
                    fontFamily: GR,
                    fontWeight: 800,
                    fontSize: 14,
                    color: C.text,
                    marginBottom: 8,
                  }}
                >
                  Report an incident
                </div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ ...fieldStyle, marginBottom: 8 }}
                >
                  <option value="">What happened?</option>
                  {CATEGORIES[role].map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={600}
                  rows={3}
                  placeholder="Describe what happened"
                  style={{ ...fieldStyle, resize: "none", marginBottom: 8 }}
                />
                {rideId && (
                  <p
                    style={{
                      fontFamily: IN,
                      fontSize: 11.5,
                      color: C.muted,
                      margin: "0 0 8px",
                    }}
                  >
                    Your current ride ({rideId}) will be attached to the report.
                  </p>
                )}
                {err && (
                  <div
                    style={{
                      color: "#B91C1C",
                      fontFamily: IN,
                      fontSize: 12.5,
                      marginBottom: 8,
                    }}
                  >
                    {err}
                  </div>
                )}
                <button
                  onClick={() => send("incident")}
                  disabled={
                    !!busy || !category || description.trim().length < 5
                  }
                  style={{
                    width: "100%",
                    padding: "13px 0",
                    background: C.navy,
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                    opacity:
                      busy || !category || description.trim().length < 5
                        ? 0.5
                        : 1,
                  }}
                >
                  {busy === "incident" ? "Sending..." : "Submit report"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
