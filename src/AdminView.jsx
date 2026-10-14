import { useState, useEffect, useCallback } from "react";
import { Truck, Star, Wifi, X } from "lucide-react";
import {
  C,
  GR,
  IN,
  TERMINALS,
  getTerm,
  fmtTime,
  getDocStatus,
  Logo,
  DISCOUNTS,
  DISCOUNT_KEYS,
  discountLabel,
  TARIFF,
  pickupLabel,
  dropoffLabel,
  fmtKm,
} from "./shared.jsx";
import {
  getDrivers,
  updateDriver,
  getTricycles,
  createTricycle,
  rentTricycle,
  renewTricycleRental,
  releaseTricycle,
  getRequests,
  getVerifications,
  getVerificationPhotos,
  reviewVerification,
} from "./api.js";

function Badge({ children, variant = "gray" }) {
  const map = {
    green: { bg: "#D1FAE5", fg: "#065F46" },
    blue: { bg: "#DBEAFE", fg: "#1E40AF" },
    gray: { bg: "#F3F4F6", fg: "#374151" },
    yellow: { bg: "#FEF3C7", fg: "#92400E" },
  };
  const { bg, fg } = map[variant] || map.gray;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: GR,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}
function statusBadge(s) {
  const m = {
    available: ["green", "\u25CF Available"],
    on_trip: ["blue", "\u25CF On Trip"],
    off_duty: ["gray", "Off Duty"],
    unassigned: ["yellow", "Not rented"],
  };
  const [v, label] = m[s] || ["gray", s];
  return <Badge variant={v}>{label}</Badge>;
}
// Dropdown to mark a driver's license / franchise Valid or Expired. A driver
// with an Expired document cannot accept or take trips.
function DocSelect({ label, kind, driver, onSaved }) {
  const [saving, setSaving] = useState(false);
  const current = getDocStatus(driver, kind);
  const expired = current.value === "expired";
  const change = async (e) => {
    setSaving(true);
    try {
      await updateDriver(driver._id, { [`${kind}Status`]: e.target.value });
      onSaved();
    } catch {
      alert("Could not update. Try again.");
    }
    setSaving(false);
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        fontFamily: IN,
        marginBottom: 3,
      }}
    >
      <span style={{ color: C.muted, minWidth: 52 }}>{label}</span>
      <select
        value={current.value}
        onChange={change}
        disabled={saving}
        style={{
          background: expired ? "#FEE2E2" : "#D1FAE5",
          color: expired ? "#991B1B" : "#065F46",
          border: "none",
          borderRadius: 8,
          padding: "2px 6px",
          fontWeight: 700,
          fontFamily: GR,
          fontSize: 10.5,
          cursor: "pointer",
        }}
      >
        <option value="valid">Valid</option>
        <option value="expired">Expired</option>
      </select>
    </div>
  );
}

// "5s ago", "3m ago", "2h ago", "1d ago"
function timeAgo(iso) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

// Active = the driver's Driver app is switched to Online and still reporting in.
// Otherwise Off duty (switched to Offline, logged out, or the app went quiet).
function DutyBadge({ driver }) {
  if (driver.appActive) {
    return <Badge variant="green">{"\u25CF"} Active</Badge>;
  }
  return (
    <div>
      <Badge variant="gray">Off duty</Badge>
      <div
        style={{ fontFamily: IN, fontSize: 10.5, color: C.muted, marginTop: 3 }}
      >
        {driver.appLastSeen
          ? `Last seen ${timeAgo(driver.appLastSeen)}`
          : "Has not opened the app"}
      </div>
    </div>
  );
}

function NfcCell({ driver, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(driver.nfcId || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateDriver(driver._id, { nfcId: val.trim() || null });
      onSaved();
    } catch {
      /* keep old value shown on failure */
    }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Card UID"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          style={{
            width: 110,
            padding: "4px 7px",
            border: `1.5px solid ${C.green}`,
            borderRadius: 6,
            fontFamily: "monospace",
            fontSize: 11,
            outline: "none",
          }}
        />
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: C.green,
            color: "#fff",
            border: "none",
            borderRadius: 5,
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {saving ? "..." : "\u2713"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      style={{
        background: driver.nfcId ? "#ECFDF5" : C.surface,
        border: "none",
        borderRadius: 8,
        padding: "5px 10px",
        fontFamily: driver.nfcId ? "monospace" : IN,
        fontWeight: driver.nfcId ? 700 : 500,
        fontSize: driver.nfcId ? 11.5 : 11,
        color: driver.nfcId ? C.greenDark : C.muted,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <Wifi size={11} />
      {driver.nfcId || "Link a card"}
    </button>
  );
}

function DriversTab({ drivers, loading, onRefresh }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}
      >
        <span
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 14,
            color: C.text,
          }}
        >
          Registered Drivers
        </span>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background: C.surface }}>
            {[
              "Driver",
              "License No.",
              "Contact",
              "Assigned Unit",
              "Rating",
              "Documents",
              "NFC Card",
              "Duty",
              "Status",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  fontFamily: GR,
                  fontWeight: 600,
                  color: C.muted,
                  textTransform: "uppercase",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={9}
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                Loading...
              </td>
            </tr>
          )}
          {!loading &&
            drivers.map((d, i) => (
              <tr
                key={d._id}
                style={{
                  borderTop: `1px solid ${C.border}`,
                  background: i % 2 === 0 ? C.white : "#FAFAF8",
                }}
              >
                <td data-label="Driver" style={{ padding: "12px 16px" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: C.navy,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.yellow,
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 11,
                        flexShrink: 0,
                      }}
                    >
                      {d.name
                        .split(" ")
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join("")}
                    </div>
                    <span
                      style={{
                        fontFamily: GR,
                        fontWeight: 600,
                        fontSize: 13,
                        color: C.text,
                      }}
                    >
                      {d.name}
                    </span>
                  </div>
                </td>
                <td
                  data-label="License No."
                  style={{
                    padding: "12px 16px",
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: C.muted,
                  }}
                >
                  {d.license}
                </td>
                <td
                  data-label="Contact"
                  style={{
                    padding: "12px 16px",
                    fontFamily: IN,
                    fontSize: 12,
                    color: C.text,
                  }}
                >
                  {d.contact}
                </td>
                <td
                  data-label="Unit"
                  style={{
                    padding: "12px 16px",
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.text,
                  }}
                >
                  {d.unit || "\u2014"}
                </td>
                <td data-label="Rating" style={{ padding: "12px 16px" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <Star size={13} color={C.yellow} fill={C.yellow} />
                    <span
                      style={{
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 13,
                        color: C.text,
                      }}
                    >
                      {d.rating}
                    </span>
                    <span
                      style={{ fontFamily: IN, fontSize: 10.5, color: C.muted }}
                    >
                      ({d.tripsCompleted})
                    </span>
                  </div>
                </td>
                <td data-label="Documents" style={{ padding: "12px 16px" }}>
                  <DocSelect
                    label="License"
                    kind="license"
                    driver={d}
                    onSaved={onRefresh}
                  />
                  <DocSelect
                    label="Franchise"
                    kind="franchise"
                    driver={d}
                    onSaved={onRefresh}
                  />
                </td>
                <td data-label="NFC Card" style={{ padding: "12px 16px" }}>
                  <NfcCell driver={d} onSaved={onRefresh} />
                </td>
                <td data-label="Duty" style={{ padding: "12px 16px" }}>
                  <DutyBadge driver={d} />
                </td>
                <td data-label="Status" style={{ padding: "12px 16px" }}>
                  {statusBadge(d.status)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// Today in the Philippines (YYYY-MM-DD), so "due" matches the TODA's calendar.
const todayManila = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

const fmtDate = (iso) =>
  iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "-";

// How a rental's monthly renewal stands: overdue, due within 5 days, or fine.
function renewalState(renewalDate) {
  const today = new Date(`${todayManila()}T00:00:00`);
  const due = new Date(`${renewalDate}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { variant: "red", label: `Overdue ${-days}d`, days };
  if (days <= 5)
    return {
      variant: "yellow",
      label: days === 0 ? "Due today" : `Due in ${days}d`,
      days,
    };
  return { variant: "green", label: `Renews in ${days}d`, days };
}

const smallBtn = (bg, fg) => ({
  background: bg,
  color: fg,
  border: "none",
  borderRadius: 6,
  padding: "5px 10px",
  fontFamily: GR,
  fontWeight: 600,
  fontSize: 11,
  cursor: "pointer",
});

const fieldStyle = {
  padding: "7px 10px",
  border: `1.5px solid ${C.border}`,
  borderRadius: 8,
  fontFamily: IN,
  fontSize: 12.5,
  outline: "none",
  background: C.white,
};

// Rental controls for one all-rounder (TODA-owned, no owner) unit.
function RentalCell({ t, freeDrivers, onChanged }) {
  const [driverId, setDriverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      setDriverId("");
      onChanged();
    } catch (e) {
      setErr(String(e.message || e).replace(/^API [^:]*failed: /, ""));
    }
    setBusy(false);
  };

  if (t.rental) {
    const st = renewalState(t.rental.renewalDate);
    const colors = {
      red: { bg: "#FEE2E2", fg: "#991B1B" },
      yellow: { bg: "#FEF3C7", fg: "#92400E" },
      green: { bg: "#D1FAE5", fg: "#065F46" },
    }[st.variant];
    return (
      <div>
        <div style={{ fontFamily: IN, fontSize: 12.5, color: C.text }}>
          Rented by <b>{t.rental.driverName}</b>
        </div>
        <div
          style={{ fontFamily: IN, fontSize: 11, color: C.muted, marginTop: 2 }}
        >
          Since {fmtDate(t.rental.startedAt)} &middot; month{" "}
          {t.rental.months || 1}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            marginTop: 6,
          }}
        >
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: GR,
              background: colors.bg,
              color: colors.fg,
            }}
          >
            {st.label}
          </span>
          <span style={{ fontFamily: IN, fontSize: 11, color: C.muted }}>
            {fmtDate(t.rental.renewalDate)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            disabled={busy}
            onClick={() => run(() => renewTricycleRental(t._id))}
            style={smallBtn(C.green, "#fff")}
          >
            Renew +1 month
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `End ${t.rental.driverName}'s rental of ${t._id}? The unit goes back to the TODA.`,
                )
              )
                run(() => releaseTricycle(t._id));
            }}
            style={smallBtn("#FEE2E2", "#991B1B")}
          >
            End rental
          </button>
        </div>
        {err && (
          <div
            style={{
              color: "#B91C1C",
              fontFamily: IN,
              fontSize: 11,
              marginTop: 6,
            }}
          >
            {err}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          style={{ ...fieldStyle, maxWidth: 170 }}
        >
          <option value="">
            {freeDrivers.length
              ? "Rent to driver..."
              : "No driver without a unit"}
          </option>
          {freeDrivers.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !driverId}
          onClick={() => run(() => rentTricycle(t._id, driverId))}
          style={{
            ...smallBtn(C.navy, "#fff"),
            opacity: busy || !driverId ? 0.5 : 1,
          }}
        >
          Rent out
        </button>
      </div>
      <div
        style={{ fontFamily: IN, fontSize: 10.5, color: C.muted, marginTop: 4 }}
      >
        Monthly, open-ended. Renews until you end it.
      </div>
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: IN,
            fontSize: 11,
            marginTop: 6,
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

// Form to register a new ownerless all-rounder unit.
function AddTodaUnit({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await createTricycle({ unit, plate });
      setUnit("");
      setPlate("");
      setOpen(false);
      onAdded();
    } catch (e) {
      setErr(String(e.message || e).replace(/^API [^:]*failed: /, ""));
    }
    setBusy(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={smallBtn(C.navy, "#fff")}>
        + Add TODA unit
      </button>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        placeholder="Unit no. (MCC-006)"
        style={{ ...fieldStyle, width: 150 }}
      />
      <input
        value={plate}
        onChange={(e) => setPlate(e.target.value)}
        placeholder="Plate no."
        style={{ ...fieldStyle, width: 110 }}
      />
      <button
        disabled={busy || !unit.trim() || !plate.trim()}
        onClick={save}
        style={{
          ...smallBtn(C.green, "#fff"),
          opacity: busy || !unit.trim() || !plate.trim() ? 0.5 : 1,
        }}
      >
        Save
      </button>
      <button
        onClick={() => setOpen(false)}
        style={smallBtn(C.surface, C.muted)}
      >
        Cancel
      </button>
      {err && (
        <span style={{ color: "#B91C1C", fontFamily: IN, fontSize: 11 }}>
          {err}
        </span>
      )}
    </div>
  );
}

function TricyclesTab({ tricycles, drivers, loading, onRefresh }) {
  // Drivers who have no tricycle of their own can be given an all-rounder.
  const freeDrivers = drivers.filter(
    (d) => !d.unit && !tricycles.some((t) => t.driverId === d._id),
  );
  const todaUnits = tricycles.filter((t) => t.allRounder);
  const rentedCount = todaUnits.filter((t) => t.rental).length;

  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 14,
              color: C.text,
            }}
          >
            Registered Tricycles
          </span>
          <div
            style={{
              fontFamily: IN,
              fontSize: 11,
              color: C.muted,
              marginTop: 2,
            }}
          >
            {todaUnits.length === 0
              ? "No TODA all-rounder units yet"
              : `${todaUnits.length} TODA all-rounder unit${todaUnits.length === 1 ? "" : "s"} (no owner) \u00B7 ${rentedCount} rented`}
          </div>
        </div>
        <AddTodaUnit onAdded={onRefresh} />
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background: C.surface }}>
            {[
              "Unit No.",
              "Plate No.",
              "Driver",
              "Terminal",
              "Status",
              "Rental",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "10px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  fontFamily: GR,
                  fontWeight: 600,
                  color: C.muted,
                  textTransform: "uppercase",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={6}
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                Loading...
              </td>
            </tr>
          )}
          {!loading &&
            tricycles.map((t, i) => (
              <tr
                key={t._id}
                style={{
                  borderTop: `1px solid ${C.border}`,
                  background: i % 2 === 0 ? C.white : "#FAFAF8",
                }}
              >
                <td data-label="Unit" style={{ padding: "12px 16px" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: C.navy,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Truck size={14} color={C.yellow} />
                    </div>
                    <div>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 13,
                          color: C.text,
                        }}
                      >
                        {t._id}
                      </span>
                      {t.allRounder && (
                        <div style={{ marginTop: 3 }}>
                          <Badge variant="yellow">
                            All-rounder &middot; TODA
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td
                  data-label="Plate"
                  style={{
                    padding: "12px 16px",
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: C.muted,
                  }}
                >
                  {t.plate}
                </td>
                <td
                  data-label="Driver"
                  style={{
                    padding: "12px 16px",
                    fontFamily: IN,
                    fontSize: 13,
                    color: t.driver ? C.text : C.muted,
                  }}
                >
                  {t.driver || (t.allRounder ? "No owner" : "-")}
                </td>
                <td
                  data-label="Terminal"
                  style={{
                    padding: "12px 16px",
                    fontFamily: IN,
                    fontSize: 12,
                    color: t.terminal ? C.text : C.muted,
                  }}
                >
                  {t.terminal ? getTerm(t.terminal)?.short : "-"}
                </td>
                <td data-label="Status" style={{ padding: "12px 16px" }}>
                  {statusBadge(t.status)}
                </td>
                <td data-label="Rental" style={{ padding: "12px 16px" }}>
                  {t.allRounder ? (
                    <RentalCell
                      t={t}
                      freeDrivers={freeDrivers}
                      onChanged={onRefresh}
                    />
                  ) : (
                    <span
                      style={{ fontFamily: IN, fontSize: 12, color: C.muted }}
                    >
                      -
                    </span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// The fare is worked out automatically from the road distance between the
// exact pickup and drop-off points (see api/_fare.js), so there is no
// per-terminal fare matrix to edit any more. This tab just shows the tariff.
function TariffTab() {
  const cols = [
    ["regular", "Regular (per person)"],
    ["special", "Special trip"],
    ["discounted", "Discounted (per person)"],
    ["discountedSpecial", "Discounted special trip"],
  ];
  return (
    <div>
      <div
        style={{
          background: C.white,
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <span
            style={{
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 14,
              color: C.text,
            }}
          >
            Official TODA Tariff
          </span>
        </div>
        <div style={{ overflowX: "auto", padding: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th
                  style={{
                    padding: "8px 16px",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: GR,
                    fontWeight: 600,
                    color: C.muted,
                    textTransform: "uppercase",
                  }}
                >
                  Distance
                </th>
                {cols.map(([k, label]) => (
                  <th
                    key={k}
                    style={{
                      padding: "8px 12px",
                      textAlign: "center",
                      fontSize: 11,
                      fontFamily: GR,
                      fontWeight: 600,
                      color: C.muted,
                      textTransform: "uppercase",
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TARIFF.rows.map((row, i) => (
                <tr
                  key={row.label}
                  style={{
                    borderTop: `1px solid ${C.border}`,
                    background: i % 2 === 0 ? C.white : "#FAFAF8",
                  }}
                >
                  <td
                    style={{
                      padding: "12px 16px",
                      fontFamily: GR,
                      fontWeight: 600,
                      fontSize: 12.5,
                      color: C.navy,
                    }}
                  >
                    {row.label}
                  </td>
                  {cols.map(([k]) => (
                    <td
                      key={k}
                      style={{
                        padding: "12px",
                        textAlign: "center",
                        fontFamily: GR,
                        fontWeight: 700,
                        fontSize: 13,
                        color: C.greenDark,
                      }}
                    >
                      {"\u20B1"}
                      {row[k]}.00
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          style={{
            margin: 0,
            padding: "10px 16px 14px",
            fontSize: 11.5,
            color: C.muted,
            fontFamily: IN,
          }}
        >
          {TARIFF.beyond}
        </p>
      </div>
      <p style={{ fontSize: 11.5, color: C.muted, fontFamily: IN, margin: 0 }}>
        Fares are calculated automatically from the road distance between the
        exact pickup and drop-off points the passenger picked on the map. The
        apps currently offer the regular per-person fare and the student /
        senior citizen / PWD discount. Special trips are not offered yet.
      </p>
    </div>
  );
}

function LogTab({ logs, loading }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}
      >
        <span
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 14,
            color: C.text,
          }}
        >
          Dispatch Log - Audit Trail
        </span>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background: C.surface }}>
            {["ID", "Route", "Driver / Unit", "Fare", "Time", "Status"].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 16px",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: GR,
                    fontWeight: 600,
                    color: C.muted,
                    textTransform: "uppercase",
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={6}
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                Loading...
              </td>
            </tr>
          )}
          {!loading && logs.length === 0 && (
            <tr>
              <td
                colSpan={6}
                style={{
                  padding: 32,
                  textAlign: "center",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                No dispatches yet.
              </td>
            </tr>
          )}
          {!loading &&
            logs.map((log, i) => (
              <tr
                key={log._id}
                style={{
                  borderTop: `1px solid ${C.border}`,
                  background: i % 2 === 0 ? C.white : "#FAFAF8",
                }}
              >
                <td
                  data-label="ID"
                  style={{
                    padding: "11px 16px",
                    fontFamily: "monospace",
                    fontSize: 11,
                    color: C.muted,
                  }}
                >
                  {log._id}
                  {log.source === "kiosk" && (
                    <div
                      style={{
                        fontFamily: GR,
                        fontSize: 9.5,
                        fontWeight: 700,
                        color: C.navy,
                        textTransform: "uppercase",
                      }}
                    >
                      Kiosk
                    </div>
                  )}
                </td>
                <td
                  data-label="Route"
                  style={{
                    padding: "11px 16px",
                    fontFamily: GR,
                    fontSize: 12,
                    color: C.text,
                    fontWeight: 600,
                  }}
                >
                  <div>{pickupLabel(log)}</div>
                  <div>
                    {"\u2192"} {dropoffLabel(log)}
                  </div>
                  {log.distanceMeters ? (
                    <div
                      style={{
                        fontFamily: IN,
                        fontWeight: 500,
                        fontSize: 10.5,
                        color: C.muted,
                      }}
                    >
                      {log.distanceEstimated ? "About " : ""}
                      {fmtKm(log.distanceMeters)}
                    </div>
                  ) : null}
                </td>
                <td data-label="Driver" style={{ padding: "11px 16px" }}>
                  <div style={{ fontFamily: IN, fontSize: 12, color: C.text }}>
                    {log.driver || "-"}
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: C.muted,
                    }}
                  >
                    {log.unit || ""} {log.plate ? `. ${log.plate}` : ""}
                  </div>
                </td>
                <td
                  data-label="Fare"
                  style={{
                    padding: "11px 16px",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 13,
                    color: C.green,
                  }}
                >
                  {"\u20B1"}
                  {log.fare}.00
                  {log.discountApplied && (
                    <div
                      style={{
                        fontFamily: IN,
                        fontWeight: 500,
                        fontSize: 10.5,
                        color: C.muted,
                      }}
                    >
                      {discountLabel(log.discountType)} discount
                      {log.regularFare ? ` (regular ₱${log.regularFare})` : ""}
                    </div>
                  )}
                  {!log.discountApplied && log.discountPending && (
                    <div
                      style={{
                        fontFamily: IN,
                        fontWeight: 500,
                        fontSize: 10.5,
                        color: "#92400E",
                      }}
                    >
                      {discountLabel(log.discountClaim)} discount (waiting for
                      driver)
                    </div>
                  )}
                </td>
                <td
                  data-label="Time"
                  style={{
                    padding: "11px 16px",
                    fontFamily: IN,
                    fontSize: 12,
                    color: C.muted,
                  }}
                >
                  {fmtTime(log.ts)}
                </td>
                <td data-label="Status" style={{ padding: "11px 16px" }}>
                  <Badge
                    variant={
                      log.status === "completed"
                        ? "green"
                        : log.status === "dispatched"
                          ? "blue"
                          : "gray"
                    }
                  >
                    {log.status}
                  </Badge>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewModal({ passenger, onClose, onDone }) {
  const claim = passenger.discountClaim || null;
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // Which discount to grant when approving (only asked if they requested one).
  // Defaults to what they asked for; staff can change it or choose "none".
  const [discountChoice, setDiscountChoice] = useState(claim || "none");

  useEffect(() => {
    getVerificationPhotos(passenger._id)
      .then(setPhotos)
      .catch(() =>
        setError(
          "Could not load the photos. They may already have been reviewed.",
        ),
      );
  }, [passenger._id]);

  const decide = async (decision) => {
    if (decision === "reject" && !reason.trim()) {
      setError("Please give a reason so the passenger knows what to fix.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewVerification(
        passenger._id,
        decision,
        reason.trim(),
        decision === "approve" ? (claim ? discountChoice : "none") : undefined,
      );
      onDone();
    } catch (err) {
      setError(
        err.message
          ? err.message.replace(/^API .* failed: /, "")
          : "Could not save the decision.",
      );
    }
    setBusy(false);
  };

  const row = (label, value) => (
    <div
      style={{
        display: "flex",
        gap: 10,
        fontFamily: IN,
        fontSize: 13,
        marginBottom: 4,
      }}
    >
      <span style={{ color: C.muted, minWidth: 74 }}>{label}</span>
      <span style={{ color: C.text, fontWeight: 600 }}>{value || "-"}</span>
    </div>
  );

  const photoList = photos
    ? [
        ["Government ID", photos.idPhoto],
        ...(photos.discountIdPhoto
          ? [
              [
                `${DISCOUNTS[claim]?.idName || "Discount ID"} (discount request)`,
                photos.discountIdPhoto,
              ],
            ]
          : []),
        ["Selfie", photos.selfie],
      ]
    : [];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 3000,
        overflowY: "auto",
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: 680,
          margin: "0 auto",
          padding: 20,
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
          <h3
            style={{
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 16,
              color: C.text,
              margin: 0,
            }}
          >
            Review account
          </h3>
          <button
            onClick={onClose}
            style={{
              background: C.surface,
              border: "none",
              borderRadius: 8,
              width: 30,
              height: 30,
              cursor: "pointer",
            }}
          >
            <X size={15} color={C.muted} />
          </button>
        </div>

        {row("Name", passenger.name)}
        {row("Username", passenger.username)}
        {row("Phone", passenger.phone)}
        {row("Address", passenger.address)}
        {row(
          "Discount",
          claim ? `Requested: ${discountLabel(claim)}` : "None requested",
        )}
        {row(
          "Submitted",
          passenger.verificationSubmittedAt
            ? fmtTime(passenger.verificationSubmittedAt)
            : "",
        )}
        <p
          style={{
            fontFamily: IN,
            fontSize: 12,
            color: C.muted,
            margin: "10px 0 14px",
            lineHeight: 1.45,
          }}
        >
          Check that the ID is real and readable, that its address is in Mary
          Cris Complex and matches the address above, and that the selfie shows
          the same person as the ID.
          {claim && (
            <>
              {" "}
              Also check that the discount ID is real, not expired, shows the
              same person, and really proves they are a{" "}
              {discountLabel(claim).toLowerCase()}.
            </>
          )}
        </p>

        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12.5,
              fontFamily: IN,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {!photos && !error && (
          <p style={{ fontFamily: IN, fontSize: 13, color: C.muted }}>
            Loading photos...
          </p>
        )}

        {photos && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginBottom: 16,
            }}
          >
            {photoList.map(([label, src]) => (
              <div key={label}>
                <p
                  style={{
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 12,
                    color: C.navy,
                    margin: "0 0 4px",
                  }}
                >
                  {label}
                </p>
                <img
                  src={src}
                  alt={label}
                  style={{ width: "100%", borderRadius: 10, display: "block" }}
                />
              </div>
            ))}
          </div>
        )}

        {photos && claim && !rejecting && (
          <label style={{ display: "block", marginBottom: 14 }}>
            <span
              style={{
                display: "block",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 12,
                color: C.navy,
                marginBottom: 4,
              }}
            >
              Discount to grant when approving
            </span>
            <select
              value={discountChoice}
              onChange={(e) => setDiscountChoice(e.target.value)}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: `1.5px solid ${C.border}`,
                fontFamily: IN,
                fontSize: 13,
                background: "#fff",
              }}
            >
              {DISCOUNT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {DISCOUNTS[k].label} discount (20% off)
                  {k === claim ? " - what they asked for" : ""}
                </option>
              ))}
              <option value="none">
                No discount - approve the account only
              </option>
            </select>
          </label>
        )}

        {photos && rejecting && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Reason for rejecting (the passenger will see this)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 70,
              padding: 10,
              borderRadius: 10,
              border: `1.5px solid ${C.border}`,
              fontFamily: IN,
              fontSize: 13,
              marginBottom: 10,
            }}
          />
        )}

        {photos && (
          <div style={{ display: "flex", gap: 10 }}>
            {!rejecting ? (
              <>
                <button
                  onClick={() => decide("approve")}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "13px 0",
                    borderRadius: 12,
                    border: "none",
                    background: C.green,
                    color: "#fff",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {busy ? "Saving..." : "Approve - make permanent"}
                </button>
                <button
                  onClick={() => setRejecting(true)}
                  disabled={busy}
                  style={{
                    flex: "0 0 auto",
                    padding: "13px 18px",
                    borderRadius: 12,
                    border: "1.5px solid #DC2626",
                    background: "#fff",
                    color: "#DC2626",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Reject
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => decide("reject")}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: "13px 0",
                    borderRadius: 12,
                    border: "none",
                    background: "#DC2626",
                    color: "#fff",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {busy ? "Saving..." : "Confirm rejection"}
                </button>
                <button
                  onClick={() => {
                    setRejecting(false);
                    setError(null);
                  }}
                  disabled={busy}
                  style={{
                    flex: "0 0 auto",
                    padding: "13px 18px",
                    borderRadius: 12,
                    border: `1.5px solid ${C.border}`,
                    background: "#fff",
                    color: C.text,
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Back
                </button>
              </>
            )}
          </div>
        )}
        <p
          style={{
            fontFamily: IN,
            fontSize: 11,
            color: C.muted,
            margin: "12px 0 0",
          }}
        >
          The photos are deleted as soon as you approve or reject.
        </p>
      </div>
    </div>
  );
}

function VerifyTab({ items, loading, onChanged }) {
  const [reviewing, setReviewing] = useState(null);
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 12,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}
      >
        <span
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 14,
            color: C.text,
          }}
        >
          Accounts waiting for verification
        </span>
      </div>
      {loading && (
        <p
          style={{
            padding: 24,
            textAlign: "center",
            color: C.muted,
            fontFamily: IN,
            fontSize: 13,
            margin: 0,
          }}
        >
          Loading...
        </p>
      )}
      {!loading && items.length === 0 && (
        <p
          style={{
            padding: 32,
            textAlign: "center",
            color: C.muted,
            fontFamily: IN,
            fontSize: 13,
            margin: 0,
          }}
        >
          No accounts are waiting. New signups will show up here.
        </p>
      )}
      {items.map((p, i) => (
        <div
          key={p._id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px",
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 13.5,
                color: C.text,
              }}
            >
              {p.name}{" "}
              <span style={{ color: C.muted, fontWeight: 500, fontSize: 12 }}>
                @{p.username}
              </span>
              {p.discountClaim && (
                <span style={{ marginLeft: 6 }}>
                  <Badge variant="yellow">
                    {discountLabel(p.discountClaim)} discount
                  </Badge>
                </span>
              )}
            </div>
            <div style={{ fontFamily: IN, fontSize: 12, color: C.muted }}>
              {p.address || "No address"}
              {p.verificationSubmittedAt
                ? " . " + fmtTime(p.verificationSubmittedAt)
                : ""}
            </div>
          </div>
          <button
            onClick={() => setReviewing(p)}
            style={{
              background: C.navy,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "9px 16px",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            Review
          </button>
        </div>
      ))}
      {reviewing && (
        <ReviewModal
          passenger={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function AdminView() {
  const [tab, setTab] = useState("drivers");
  const [drivers, setDrivers] = useState([]);
  const [tricycles, setTricycles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [verifs, setVerifs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [d, t, l] = await Promise.all([
        getDrivers(),
        getTricycles(),
        getRequests({}),
      ]);
      setDrivers(d);
      setTricycles(t);
      setLogs(l);
    } catch {
      /* keep last known good state */
    }
    try {
      setVerifs(await getVerifications());
    } catch {
      /* keep last known list */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 8000);
    return () => clearInterval(id);
  }, [loadAll]);

  const stats = [
    {
      label: "Registered Drivers",
      value: drivers.length,
      sub: `${drivers.filter((d) => d.appActive).length} active in the app`,
    },
    {
      label: "Tricycle Units",
      value: tricycles.length,
      sub: `${tricycles.filter((t) => t.status === "available").length} at terminal`,
    },
    { label: "Dispatch Log Entries", value: logs.length, sub: "all time" },
    {
      label: "Terminal Coverage",
      value: `${TERMINALS.length} / ${TERMINALS.length}`,
      sub: "all active",
    },
  ];

  return (
    <div style={{ height: "100%", background: C.surface, overflowY: "auto" }}>
      <div
        style={{
          background: C.navy,
          padding: "14px clamp(12px,4vw,24px)",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Logo size={24} />
        <div
          style={{ width: 1, height: 26, background: "rgba(255,255,255,0.15)" }}
          className="hide-xs"
        />
        <div className="hide-xs">
          <div
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 10,
              fontFamily: GR,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Admin Dashboard
          </div>
          <div
            style={{
              color: "#fff",
              fontWeight: 700,
              fontFamily: GR,
              fontSize: 14,
            }}
          >
            Mary Cris Complex TODA
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "clamp(12px,3vw,20px)",
        }}
      >
        <div
          className="admin-stats-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                background: C.white,
                borderRadius: 12,
                padding: "14px 16px",
                border: `1px solid ${C.border}`,
              }}
            >
              <div
                style={{
                  fontSize: "clamp(20px,5vw,26px)",
                  fontWeight: 700,
                  fontFamily: GR,
                  color: C.navy,
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  fontFamily: GR,
                  color: C.text,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, fontFamily: IN }}>
                {s.sub}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            overflow: "hidden",
            marginBottom: 16,
            overflowX: "auto",
          }}
        >
          {[
            ["drivers", "Drivers"],
            ["tricycles", "Tricycles"],
            ["fares", "Tariff"],
            ["verify", "Verify"],
            ["log", "Log"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: "1 1 auto",
                minWidth: 70,
                padding: "11px 8px",
                border: "none",
                borderBottom:
                  tab === key ? `3px solid ${C.navy}` : "3px solid transparent",
                background: tab === key ? C.surface : "transparent",
                fontFamily: GR,
                fontSize: 12.5,
                fontWeight: 600,
                color: tab === key ? C.navy : C.muted,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {label}
              {key === "verify" && verifs.length > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background: "#DC2626",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "1px 7px",
                    fontSize: 10.5,
                  }}
                >
                  {verifs.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "drivers" && (
          <DriversTab drivers={drivers} loading={loading} onRefresh={loadAll} />
        )}
        {tab === "tricycles" && (
          <TricyclesTab
            tricycles={tricycles}
            drivers={drivers}
            loading={loading}
            onRefresh={loadAll}
          />
        )}
        {tab === "fares" && <TariffTab />}
        {tab === "verify" && (
          <VerifyTab items={verifs} loading={loading} onChanged={loadAll} />
        )}
        {tab === "log" && <LogTab logs={logs} loading={loading} />}
      </div>
    </div>
  );
}
