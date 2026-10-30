import { useState, useEffect, useCallback, useRef } from "react";
import { Truck, Star, Wifi, X } from "lucide-react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import {
  C,
  GR,
  IN,
  TERMINALS,
  COMPLEX_CENTER,
  getTerm,
  fmtTime,
  getDocStatus,
  Logo,
  DISCOUNTS,
  DISCOUNT_KEYS,
  discountLabel,
  pickupLabel,
  dropoffLabel,
  fmtKm,
  useNotice,
} from "./shared.jsx";
import {
  getDrivers,
  updateDriver,
  createDriver,
  importDrivers,
  getTricycles,
  createTricycle,
  rentTricycle,
  renewTricycleRental,
  releaseTricycle,
  getRequests,
  overrideRequest,
  cancelRequest,
  getVerifications,
  getUserStats,
  getReports,
  getAlerts,
  getTariff,
  updateTariff,
  getAttendance,
  getAllQueues,
  getDriverLocations,
  getStaffCards,
  createStaffCard,
  updateStaffCard,
  deleteStaffCard,
  updateReport,
  getPassengers,
  setTimeLeft,
  getVerificationPhotos,
  reviewVerification,
} from "./api.js";

function Badge({ children, variant = "gray" }) {
  const map = {
    green: { bg: "#D1FAE5", fg: "#065F46" },
    blue: { bg: "#DBEAFE", fg: "#1E40AF" },
    gray: { bg: "#F3F4F6", fg: "#374151" },
    yellow: { bg: "#FEF3C7", fg: "#92400E" },
    red: { bg: "#FEE2E2", fg: "#991B1B" },
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

// ── Add drivers: one by one, or from an Excel sheet ─────────────────────────
const IMPORT_MAX = 50;
// Spreadsheet column titles (any case / spacing) -> driver fields.
const COLUMN_ALIASES = {
  name: "name",
  fullname: "name",
  drivername: "name",
  username: "username",
  password: "password",
  license: "license",
  licenseno: "license",
  licensenumber: "license",
  contact: "contact",
  contactno: "contact",
  phone: "contact",
  mobile: "contact",
  unit: "unit",
  unitno: "unit",
  plate: "plate",
  plateno: "plate",
  nfc: "nfcId",
  nfcid: "nfcId",
  nfccard: "nfcId",
  licensestatus: "licenseStatus",
  franchisestatus: "franchiseStatus",
};
const TEMPLATE_HEADERS = [
  "Name",
  "Username",
  "Password",
  "License No",
  "Contact",
  "Unit",
  "Plate",
  "NFC Card",
  "License Status",
  "Franchise Status",
];

// 2-D array of cells (first row = titles) -> array of driver objects.
function rowsToDrivers(sheet) {
  if (!sheet || sheet.length < 2) return [];
  const fields = sheet[0].map(
    (h) =>
      COLUMN_ALIASES[
        String(h ?? "")
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      ],
  );
  return sheet
    .slice(1)
    .filter((r) => r.some((c) => c !== null && c !== undefined && c !== ""))
    .map((r) => {
      const o = {};
      fields.forEach((f, i) => {
        if (f && r[i] !== null && r[i] !== undefined)
          o[f] = String(r[i]).trim();
      });
      return o;
    });
}

// Minimal CSV parser (quotes supported) so a CSV saved from Excel also works.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const cleanErr = (e) =>
  String(e?.message || e).replace(/^API [^:]*failed: /, "");

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          borderRadius: 12,
          width: "100%",
          maxWidth: wide ? 760 : 460,
          maxHeight: "90vh",
          overflow: "auto",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 15,
              color: C.text,
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{ ...smallBtn("transparent", C.muted), padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const EMPTY_DRIVER = {
  name: "",
  username: "",
  password: "",
  license: "",
  contact: "",
  unit: "",
  plate: "",
  nfcId: "",
  licenseStatus: "valid",
  franchiseStatus: "valid",
};

function AddDriverModal({ onClose, onDone }) {
  const [f, setF] = useState(EMPTY_DRIVER);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useNotice("");
  const [created, setCreated] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      setCreated(await createDriver(f));
      onDone();
    } catch (e) {
      setErr(cleanErr(e));
    }
    setBusy(false);
  };

  const input = (k, label, extra = {}) => (
    <label
      style={{ display: "block", fontFamily: IN, fontSize: 11, color: C.muted }}
    >
      {label}
      <input
        value={f[k]}
        onChange={set(k)}
        style={{
          ...fieldStyle,
          width: "100%",
          boxSizing: "border-box",
          marginTop: 3,
        }}
        {...extra}
      />
    </label>
  );

  if (created) {
    return (
      <Modal title="Driver created" onClose={onClose}>
        <div
          style={{
            fontFamily: IN,
            fontSize: 13,
            color: C.text,
            lineHeight: 1.7,
          }}
        >
          <b>{created.name}</b> ({created.id})
          <br />
          Username: <b>{created.username}</b>
          <br />
          Password: <b>{created.password}</b>
        </div>
        <div
          style={{
            fontFamily: IN,
            fontSize: 11.5,
            color: C.muted,
            margin: "10px 0",
          }}
        >
          {created.generated
            ? "This password was generated and will not be shown again. Give it to the driver now."
            : "Give these login details to the driver."}
        </div>
        <button onClick={onClose} style={smallBtn(C.navy, "#fff")}>
          Done
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Add driver" onClose={onClose}>
      <div style={{ display: "grid", gap: 10 }}>
        {input("name", "Full name *")}
        {input("username", "Username * (for the Driver app login)")}
        {input("password", "Password (leave blank to generate one)", {
          type: "text",
          autoComplete: "off",
        })}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {input("license", "License no.")}
          {input("contact", "Contact no.")}
          {input("unit", "Unit no. (e.g. MCC-008)")}
          {input("plate", "Plate no.")}
        </div>
        {input("nfcId", "NFC card ID (optional)")}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          {["licenseStatus", "franchiseStatus"].map((k) => (
            <label
              key={k}
              style={{ fontFamily: IN, fontSize: 11, color: C.muted }}
            >
              {k === "licenseStatus" ? "License" : "Franchise"}
              <select
                value={f[k]}
                onChange={set(k)}
                style={{ ...fieldStyle, width: "100%", marginTop: 3 }}
              >
                <option value="valid">Valid</option>
                <option value="expired">Expired</option>
              </select>
            </label>
          ))}
        </div>
        <div style={{ fontFamily: IN, fontSize: 11, color: C.muted }}>
          Leave Unit and Plate blank if the driver has no tricycle (you can rent
          them a TODA unit in the Tricycles tab).
        </div>
        {err && (
          <div style={{ color: "#B91C1C", fontFamily: IN, fontSize: 12 }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={busy || !f.name.trim() || !f.username.trim()}
            onClick={save}
            style={{
              ...smallBtn(C.green, "#fff"),
              opacity: busy || !f.name.trim() || !f.username.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "Saving..." : "Create driver"}
          </button>
          <button onClick={onClose} style={smallBtn(C.surface, C.muted)}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ImportDriversModal({ onClose, onDone }) {
  const [rows, setRows] = useState(null); // parsed drivers, before sending
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useNotice("");
  const [result, setResult] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setResult(null);
    try {
      let sheet;
      if (/\.csv$/i.test(file.name)) {
        sheet = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      } else if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        sheet = await readSheet(file);
      } else {
        throw new Error("Please choose an .xlsx (Excel) or .csv file");
      }
      const parsed = rowsToDrivers(sheet);
      if (!parsed.length)
        throw new Error("No drivers found. Check the column titles in row 1.");
      if (parsed.length > IMPORT_MAX)
        throw new Error(
          `At most ${IMPORT_MAX} drivers per file (found ${parsed.length}).`,
        );
      setFileName(file.name);
      setRows(parsed);
    } catch (ex) {
      setRows(null);
      setErr(cleanErr(ex));
    }
  };

  const send = async () => {
    setBusy(true);
    setErr("");
    try {
      setResult(await importDrivers(rows));
      onDone();
    } catch (ex) {
      setErr(cleanErr(ex));
    }
    setBusy(false);
  };

  const th = {
    padding: "6px 8px",
    textAlign: "left",
    fontSize: 11,
    color: C.muted,
  };
  const td = {
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: IN,
    color: C.text,
  };

  return (
    <Modal title="Import drivers from Excel" onClose={onClose} wide>
      {!result && (
        <>
          <div
            style={{
              fontFamily: IN,
              fontSize: 12,
              color: C.muted,
              lineHeight: 1.6,
            }}
          >
            Row 1 = column titles: <b>{TEMPLATE_HEADERS.join(", ")}</b>. Only{" "}
            <b>Name</b> and <b>Username</b> are required. A blank Password gets
            a generated one. Statuses are <b>Valid</b> or <b>Expired</b>. Up to{" "}
            {IMPORT_MAX} drivers per file.
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              margin: "12px 0",
            }}
          >
            <label
              style={{ ...smallBtn(C.navy, "#fff"), display: "inline-block" }}
            >
              Choose .xlsx / .csv file
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={pick}
                style={{ display: "none" }}
              />
            </label>
            <button
              onClick={() =>
                downloadCsv("drivers-template.csv", [
                  TEMPLATE_HEADERS,
                  [
                    "Juan Dela Cruz",
                    "juan",
                    "",
                    "N01-23-123456",
                    "0917 000 0000",
                    "MCC-008",
                    "ABL-8901",
                    "",
                    "Valid",
                    "Valid",
                  ],
                ])
              }
              style={smallBtn(C.surface, C.text)}
            >
              Download template
            </button>
          </div>
        </>
      )}
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: IN,
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          {err}
        </div>
      )}
      {rows && !result && (
        <>
          <div
            style={{
              fontFamily: IN,
              fontSize: 12,
              color: C.text,
              marginBottom: 6,
            }}
          >
            {fileName}: <b>{rows.length}</b> driver
            {rows.length === 1 ? "" : "s"} found
          </div>
          <div
            style={{
              overflow: "auto",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {[
                    "#",
                    "Name",
                    "Username",
                    "Unit",
                    "Plate",
                    "License",
                    "Franchise",
                  ].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{r.name}</td>
                    <td style={td}>{r.username}</td>
                    <td style={td}>{r.unit}</td>
                    <td style={td}>{r.plate}</td>
                    <td style={td}>{r.licenseStatus || "Valid"}</td>
                    <td style={td}>{r.franchiseStatus || "Valid"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              disabled={busy}
              onClick={send}
              style={{ ...smallBtn(C.green, "#fff"), opacity: busy ? 0.5 : 1 }}
            >
              {busy
                ? "Creating..."
                : `Create ${rows.length} account${rows.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => setRows(null)}
              style={smallBtn(C.surface, C.muted)}
            >
              Clear
            </button>
          </div>
        </>
      )}
      {result && (
        <>
          <div
            style={{
              fontFamily: IN,
              fontSize: 13,
              color: C.text,
              marginBottom: 8,
            }}
          >
            <b style={{ color: "#065F46" }}>{result.created} created</b>
            {result.failed > 0 && (
              <>
                {" · "}
                <b style={{ color: "#B91C1C" }}>{result.failed} failed</b>
              </>
            )}
          </div>
          <div
            style={{
              fontFamily: IN,
              fontSize: 11.5,
              color: C.muted,
              marginBottom: 8,
            }}
          >
            Passwords are shown only now. Download the list and give each driver
            their login.
          </div>
          <div
            style={{
              overflow: "auto",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {["Row", "Result", "Username", "Password"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr
                    key={r.row}
                    style={{ borderTop: `1px solid ${C.border}` }}
                  >
                    <td style={td}>{r.row}</td>
                    <td style={{ ...td, color: r.ok ? "#065F46" : "#B91C1C" }}>
                      {r.ok ? `Created (${r.id})` : r.error}
                    </td>
                    <td style={td}>{r.ok ? r.username : ""}</td>
                    <td style={td}>{r.ok ? r.password : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() =>
                downloadCsv("new-driver-logins.csv", [
                  [
                    "Row",
                    "Result",
                    "Name",
                    "Driver ID",
                    "Username",
                    "Password",
                  ],
                  ...result.results.map((r) => [
                    r.row,
                    r.ok ? "Created" : r.error,
                    r.name || "",
                    r.id || "",
                    r.username || "",
                    r.password || "",
                  ]),
                ])
              }
              style={smallBtn(C.navy, "#fff")}
            >
              Download logins (CSV)
            </button>
            <button onClick={onClose} style={smallBtn(C.surface, C.muted)}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function DriversTab({ drivers, loading, onRefresh }) {
  const [modal, setModal] = useState(null); // "add" | "import" | null
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
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setModal("add")}
            style={smallBtn(C.navy, "#fff")}
          >
            + Add driver
          </button>
          <button
            onClick={() => setModal("import")}
            style={smallBtn(C.surface, C.text)}
          >
            Import from Excel
          </button>
        </div>
      </div>
      {modal === "add" && (
        <AddDriverModal onClose={() => setModal(null)} onDone={onRefresh} />
      )}
      {modal === "import" && (
        <ImportDriversModal onClose={() => setModal(null)} onDone={onRefresh} />
      )}
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
                colSpan={8}
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
  const [err, setErr] = useNotice("");

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
  const [err, setErr] = useNotice("");

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

// The tariff numbers. Admin edits them here; every fare a passenger is quoted
// uses them from the next quote on (see api/_fare.js, api/fares.js).
const TARIFF_FIELDS = [
  ["firstKm", "First distance (km)", "km"],
  ["firstKmFare", "Fare for the first distance", "\u20B1"],
  ["stepKm", "Then, for every additional (km)", "km"],
  ["stepFare", "add this much", "\u20B1"],
  ["discountPercent", "Student / Senior / PWD discount", "%"],
  ["specialMultiplier", "Special trip = regular fare x", "x"],
];

function TariffTab() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useNotice("");
  const [saved, setSaved] = useNotice("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getTariff();
      setData(d);
      setForm(
        Object.fromEntries(
          Object.entries(d.tariff).map(([k, v]) => [k, String(v)]),
        ),
      );
    } catch (e) {
      setErr(e.message || "Could not load the tariff");
    }
  }, [setErr]);
  useEffect(() => {
    load();
  }, [load]);

  const changed =
    data && TARIFF_FIELDS.some(([k]) => Number(form[k]) !== data.tariff[k]);

  const save = async () => {
    const next = {};
    for (const [k, label] of TARIFF_FIELDS) {
      const n = Number(form[k]);
      if (form[k] === "" || !Number.isFinite(n)) {
        setErr(`${label}: enter a number`);
        return;
      }
      next[k] = n;
    }
    if (
      !window.confirm(
        "Save the new tariff? Passengers will be quoted these fares from now on. Rides already booked keep their fare.",
      )
    )
      return;
    setBusy(true);
    try {
      const d = await updateTariff(next);
      setData(d);
      setForm(
        Object.fromEntries(
          Object.entries(d.tariff).map(([k, v]) => [k, String(v)]),
        ),
      );
      setSaved("Tariff saved");
    } catch (e) {
      setErr(String(e.message || e).replace(/^API [^:]*failed: /, ""));
    }
    setBusy(false);
  };

  const cols = [
    ["regular", "Regular (per person)"],
    ["special", "Special trip"],
    ["discounted", "Discounted (per person)"],
    ["discountedSpecial", "Discounted special trip"],
  ];
  const th = {
    padding: "8px 12px",
    textAlign: "center",
    fontSize: 11,
    fontFamily: GR,
    fontWeight: 600,
    color: C.muted,
    textTransform: "uppercase",
  };
  return (
    <div>
      <div
        style={{
          background: C.white,
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          padding: "14px 16px",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 14,
            color: C.text,
            marginBottom: 10,
          }}
        >
          Edit the TODA tariff
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
            gap: 10,
          }}
        >
          {TARIFF_FIELDS.map(([k, label, unit]) => (
            <label
              key={k}
              style={{ fontFamily: GR, fontSize: 12, color: C.muted }}
            >
              {label}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={form[k] ?? ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  style={{
                    width: 110,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    fontFamily: GR,
                    fontSize: 14,
                  }}
                />
                <span style={{ fontWeight: 700 }}>{unit}</span>
              </div>
            </label>
          ))}
        </div>
        {err && (
          <div
            style={{
              color: "#B91C1C",
              fontFamily: GR,
              fontSize: 13,
              marginTop: 10,
            }}
          >
            {err}
          </div>
        )}
        {saved && (
          <div
            style={{
              color: C.greenDark,
              fontFamily: GR,
              fontSize: 13,
              marginTop: 10,
            }}
          >
            {saved}
          </div>
        )}
        <div
          style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}
        >
          <button
            onClick={save}
            disabled={busy || !changed}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: C.navy,
              color: "#fff",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              opacity: busy || !changed ? 0.5 : 1,
            }}
          >
            {busy ? "Saving..." : "Save tariff"}
          </button>
          {data && (
            <button
              onClick={() =>
                setForm(
                  Object.fromEntries(
                    Object.entries(data.defaults).map(([k, v]) => [
                      k,
                      String(v),
                    ]),
                  ),
                )
              }
              style={{
                padding: "9px 14px",
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                background: C.white,
                fontFamily: GR,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Fill in the original TODA numbers
            </button>
          )}
        </div>
        {data?.updatedAt && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 11.5,
              color: C.muted,
              fontFamily: IN,
            }}
          >
            Last changed {new Date(data.updatedAt).toLocaleString()}
          </p>
        )}
      </div>

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
            Tariff now in force
          </span>
        </div>
        <div style={{ overflowX: "auto", padding: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...th, padding: "8px 16px", textAlign: "left" }}>
                  Distance
                </th>
                {cols.map(([k, label]) => (
                  <th key={k} style={th}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row, i) => (
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
          and so on, adding the same amount for every additional step.
        </p>
      </div>
      <p style={{ fontSize: 11.5, color: C.muted, fontFamily: IN, margin: 0 }}>
        Fares are calculated from the road distance between the exact pickup and
        drop-off points on the map. The apps currently offer the regular
        per-person fare and the discount. Special trips are not offered yet.
      </p>
    </div>
  );
}

function OverrideTab({ waiting, drivers, loading, onChanged }) {
  const [err, setErr] = useNotice("");
  const [pick, setPick] = useState({});
  const [reason, setReason] = useState({});
  const [busy, setBusy] = useState("");

  // Only drivers who could actually take the ride.
  const eligible = drivers.filter(
    (d) =>
      d.status !== "on_trip" &&
      getDocStatus(d, "license") !== "expired" &&
      getDocStatus(d, "franchise") !== "expired",
  );

  const assign = async (r) => {
    setBusy(r._id);
    try {
      await overrideRequest(r._id, pick[r._id], reason[r._id] || "");
      onChanged();
    } catch (e) {
      setErr(e.message || "Failed");
    }
    setBusy("");
  };
  const cancel = async (r) => {
    if (!window.confirm(`Cancel ${r._id}?`)) return;
    setBusy(r._id);
    try {
      await cancelRequest(r._id);
      onChanged();
    } catch (e) {
      setErr(e.message || "Failed");
    }
    setBusy("");
  };

  const input = {
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    fontFamily: GR,
    fontSize: 13,
  };

  return (
    <div>
      <p
        style={{
          fontFamily: GR,
          fontSize: 12.5,
          color: C.muted,
          margin: "0 0 12px",
        }}
      >
        Manual override: assign a waiting ride to a driver when the NFC tap
        can't happen (lost card, reader or kiosk offline). Expired license or
        franchise still blocks the driver. Every override is logged.
      </p>
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: GR,
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      {loading && (
        <div style={{ fontFamily: GR, color: C.muted }}>Loading...</div>
      )}
      {!loading && waiting.length === 0 && (
        <div
          style={{
            fontFamily: GR,
            color: C.muted,
            padding: 24,
            textAlign: "center",
          }}
        >
          No rides are waiting for a driver.
        </div>
      )}
      {waiting.map((r) => (
        <div
          key={r._id}
          style={{
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
            fontFamily: GR,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <b style={{ fontSize: 14, color: C.text }}>{r._id}</b>
            <Badge variant={r.source === "kiosk" ? "blue" : "gray"}>
              {r.source === "kiosk" ? "Kiosk" : "App"}
            </Badge>
            {r.discountClaim && (
              <Badge variant="yellow">Claims {r.discountClaim}</Badge>
            )}
            <span
              style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted }}
            >
              {new Date(r.ts).toLocaleTimeString()}
            </span>
          </div>
          <div style={{ fontSize: 13, color: C.text, marginTop: 6 }}>
            {r.origin} → {r.destination} · ₱{r.fare}
            {r.passengerName ? ` · ${r.passengerName}` : ""}
          </div>
          <div
            style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
          >
            <select
              value={pick[r._id] || ""}
              onChange={(e) => setPick({ ...pick, [r._id]: e.target.value })}
              style={{ ...input, flex: "1 1 160px" }}
            >
              <option value="">Choose driver…</option>
              {eligible.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} · {d.unit}
                </option>
              ))}
            </select>
            <input
              value={reason[r._id] || ""}
              maxLength={200}
              onChange={(e) =>
                setReason({ ...reason, [r._id]: e.target.value })
              }
              placeholder="Reason (e.g. lost NFC card)"
              style={{ ...input, flex: "2 1 200px" }}
            />
            <button
              disabled={
                busy === r._id ||
                !pick[r._id] ||
                (reason[r._id] || "").trim().length < 3
              }
              onClick={() => assign(r)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: C.navy,
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                opacity:
                  !pick[r._id] || (reason[r._id] || "").trim().length < 3
                    ? 0.5
                    : 1,
              }}
            >
              Assign
            </button>
            <button
              disabled={busy === r._id}
              onClick={() => cancel(r)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #DC2626",
                background: C.white,
                color: "#DC2626",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Cancel ride
            </button>
          </div>
        </div>
      ))}
      <StaffCards />
    </div>
  );
}

function StaffCards() {
  const [cards, setCards] = useState([]);
  const [err, setErr] = useNotice("");
  const [ok, setOk] = useNotice("");
  const [f, setF] = useState({ name: "", nfcId: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setCards(await getStaffCards());
    } catch {
      /* keep list */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, text) => {
    setBusy(true);
    try {
      await fn();
      setOk(text);
      await load();
    } catch (e) {
      setErr(e.message?.replace(/^API .* failed: /, "") || "Failed");
    }
    setBusy(false);
  };
  const input = {
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    fontFamily: GR,
    fontSize: 13,
  };
  const small = (color) => ({
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: C.white,
    color,
    fontFamily: GR,
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div style={{ marginTop: 24, fontFamily: GR }}>
      <h3 style={{ fontSize: 15, color: C.text, margin: "0 0 4px" }}>
        Staff cards
      </h3>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 10px" }}>
        An admin taps their card at the kiosk, enters the PIN, and gets the
        staff panel (assign a driver, cancel a ride, manual check-in). The panel
        closes itself after 5 minutes. Card numbers can't match a driver's card.
      </p>
      {err && (
        <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 8 }}>
          {err}
        </div>
      )}
      {ok && (
        <div style={{ color: C.green, fontSize: 13, marginBottom: 8 }}>
          {ok}
        </div>
      )}
      {cards.map((c) => (
        <div
          key={c.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 8,
          }}
        >
          <b style={{ fontSize: 13.5, color: C.text }}>{c.name}</b>
          <span style={{ fontSize: 12, color: C.muted }}>
            card ···{c.cardEnd}
          </span>
          <Badge variant={c.active ? "green" : "gray"}>
            {c.active ? "active" : "disabled"}
          </Badge>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              disabled={busy}
              style={small(C.navy)}
              onClick={() => {
                const pin = window.prompt("New PIN (4-8 digits)");
                if (pin)
                  run(() => updateStaffCard(c.id, { pin }), "PIN changed");
              }}
            >
              Reset PIN
            </button>
            <button
              disabled={busy}
              style={small(C.navy)}
              onClick={() =>
                run(
                  () => updateStaffCard(c.id, { active: !c.active }),
                  c.active ? "Card disabled" : "Card enabled",
                )
              }
            >
              {c.active ? "Disable" : "Enable"}
            </button>
            <button
              disabled={busy}
              style={small("#DC2626")}
              onClick={() => {
                if (window.confirm(`Delete ${c.name}'s card?`))
                  run(() => deleteStaffCard(c.id), "Card deleted");
              }}
            >
              Delete
            </button>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <input
          style={{ ...input, flex: "1 1 130px" }}
          placeholder="Name"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <input
          style={{ ...input, flex: "1 1 150px" }}
          placeholder="Card number (tap it here)"
          inputMode="numeric"
          value={f.nfcId}
          onChange={(e) =>
            setF({ ...f, nfcId: e.target.value.replace(/\D/g, "") })
          }
        />
        <input
          style={{ ...input, flex: "1 1 90px" }}
          placeholder="PIN"
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={f.pin}
          onChange={(e) =>
            setF({ ...f, pin: e.target.value.replace(/\D/g, "") })
          }
        />
        <button
          disabled={
            busy ||
            f.name.trim().length < 2 ||
            f.nfcId.length < 6 ||
            f.pin.length < 4
          }
          onClick={() =>
            run(async () => {
              await createStaffCard(f);
              setF({ name: "", nfcId: "", pin: "" });
            }, "Staff card added")
          }
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "none",
            background: C.navy,
            color: "#fff",
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            opacity:
              busy ||
              f.name.trim().length < 2 ||
              f.nfcId.length < 6 ||
              f.pin.length < 4
                ? 0.5
                : 1,
          }}
        >
          Add card
        </button>
      </div>
    </div>
  );
}

function AttendanceTab({ drivers }) {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useNotice("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getAttendance(date);
        if (alive) setRows(r.rows);
      } catch (e) {
        if (alive)
          setErr(e.message?.replace(/^API .* failed: /, "") || "Failed");
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const presentIds = new Set(rows.map((r) => r.driverId));
  const absent = drivers.filter((d) => !presentIds.has(d._id));
  const time = (iso) =>
    new Date(iso).toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const [lines, setLines] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getAllQueues();
        if (alive) setLines(r);
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
  }, []);

  return (
    <div style={{ fontFamily: GR }}>
      <h3 style={{ fontSize: 14, color: C.text, margin: "0 0 8px" }}>
        Pila ngayon
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {lines.map((l) => (
          <div
            key={l.terminal}
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text }}>
              {getTerm(l.terminal)?.short || l.terminal}
            </div>
            <div
              style={{ fontSize: 12.5, color: C.muted, margin: "2px 0 8px" }}
            >
              🛺 {l.drivers.length} tricycle · 🧍 {l.passengers.total} pasahero
              {l.passengers.total > 0 &&
                ` (${l.passengers.atTerminal} sa terminal, ${l.passengers.app} app)`}
            </div>
            {l.drivers.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>
                Walang nakapila
              </div>
            ) : (
              l.drivers.map((d) => (
                <div
                  key={d.driverId}
                  style={{
                    fontSize: 12.5,
                    color: d.position === 1 ? C.green : C.text,
                    fontWeight: d.position === 1 ? 800 : 500,
                  }}
                >
                  #{d.position} {d.name} {d.unit ? `· ${d.unit}` : ""}
                </div>
              ))
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            fontFamily: GR,
            fontSize: 13,
          }}
        />
        <span style={{ fontSize: 13, color: C.muted }}>
          {rows.length} present · {absent.length} not yet tapped
        </span>
      </div>
      {err && (
        <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 8 }}>
          {err}
        </div>
      )}
      <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
        A driver is counted present at a terminal when they tap their NFC card
        at its kiosk (or staff check them in). Tapping to accept a ride counts
        too.
      </p>
      {rows.map((r) => (
        <div
          key={r._id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            background: C.white,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "9px 12px",
            marginBottom: 6,
            fontSize: 13,
          }}
        >
          <b style={{ color: C.text }}>{r.driverName}</b>
          <span style={{ color: C.muted }}>
            {r.unit || "-"} · {r.terminal}
          </span>
          <Badge variant={r.via === "manual" ? "yellow" : "green"}>
            {r.via === "manual" ? "manual" : "tapped"}
          </Badge>
          <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>
            in {time(r.firstTapAt)}
            {r.taps > 1 ? ` · last ${time(r.lastTapAt)}` : ""}
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <div
          style={{
            color: C.muted,
            fontSize: 13,
            padding: 16,
            textAlign: "center",
          }}
        >
          No one has checked in on this date.
        </div>
      )}
      {absent.length > 0 && (
        <>
          <h3 style={{ fontSize: 13.5, color: C.text, margin: "16px 0 6px" }}>
            Not yet tapped
          </h3>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
            {absent
              .map((d) => `${d.name}${d.unit ? ` (${d.unit})` : ""}`)
              .join(" · ")}
          </div>
        </>
      )}
    </div>
  );
}

const agoText = (iso) => {
  const s = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

const driverPin = (label, live) =>
  L.divIcon({
    className: "",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)">
      <div style="background:${live ? "#16A34A" : "#6B7280"};color:#fff;border:2px solid #fff;border-radius:14px;padding:3px 8px;font:700 11px 'Space Grotesk',sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4)">${label}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${live ? "#16A34A" : "#6B7280"}"></div>
    </div>`,
    iconSize: [0, 0],
  });

const esc = (t) =>
  String(t ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function FitOnce({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    map.fitBounds(points, { padding: [40, 40], maxZoom: 17 });
  }, [points, map]);
  return null;
}

function DriversMapTab() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useNotice("");
  const [focus, setFocus] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getDriverLocations();
        if (alive) setRows(r);
      } catch (e) {
        if (alive)
          setErr(e.message?.replace(/^API .* failed: /, "") || "Failed");
      }
      if (alive) tick((n) => n + 1);
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const located = rows.filter((r) => r.location);
  const unlocated = rows.filter((r) => !r.location);
  const points = located.map((r) => [r.location.lat, r.location.lng]);

  return (
    <div style={{ fontFamily: GR }}>
      <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 10px" }}>
        Each driver's last shared location from their Driver app.{" "}
        <b style={{ color: "#16A34A" }}>Green</b> = online now,{" "}
        <b style={{ color: "#6B7280" }}>gray</b> = last known spot (offline).
        Drivers who never turned on location sharing are listed below the map.
      </p>
      {err && (
        <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 8 }}>
          {err}
        </div>
      )}
      <div
        style={{
          height: 460,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${C.border}`,
        }}
      >
        <MapContainer
          center={COMPLEX_CENTER}
          zoom={16}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          <FitOnce points={points} />
          {focus && <FlyTo point={focus} />}
          {TERMINALS.map((t) => (
            <Marker
              key={t.id}
              position={[t.lat, t.lng]}
              icon={L.divIcon({
                className: "",
                html: `<div style="transform:translate(-50%,-50%);background:${C.navy};color:#fff;border:2px solid #fff;border-radius:6px;padding:2px 6px;font:700 10px 'Space Grotesk',sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${esc(t.short)}</div>`,
                iconSize: [0, 0],
              })}
            />
          ))}
          {located.map((r) => (
            <Marker
              key={r.id}
              position={[r.location.lat, r.location.lng]}
              icon={driverPin(esc(r.unit || r.name), r.live)}
            >
              <Popup>
                <b>{r.name}</b>
                <br />
                {r.unit || "-"} · {r.live ? "online" : "offline"}
                <br />
                {r.live ? "Updated" : "Last seen"} {agoText(r.location.at)}
                {r.status === "on_trip" && (
                  <>
                    <br />
                    On a trip
                  </>
                )}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div style={{ marginTop: 12 }}>
        {located.map((r) => (
          <button
            key={r.id}
            onClick={() =>
              setFocus({
                lat: r.location.lat,
                lng: r.location.lng,
                k: Date.now(),
              })
            }
            style={{
              display: "flex",
              width: "100%",
              gap: 8,
              alignItems: "center",
              textAlign: "left",
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "9px 12px",
              marginBottom: 6,
              fontFamily: GR,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: r.live ? "#16A34A" : "#9CA3AF",
                flexShrink: 0,
              }}
            />
            <b style={{ color: C.text }}>{r.name}</b>
            <span style={{ color: C.muted }}>{r.unit || "-"}</span>
            <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>
              {r.live ? "live" : "last seen"} · {agoText(r.location.at)}
            </span>
          </button>
        ))}
        {unlocated.length > 0 && (
          <p style={{ fontSize: 12.5, color: C.muted, margin: "10px 0 0" }}>
            No location yet:{" "}
            {unlocated
              .map((d) => `${d.name}${d.unit ? ` (${d.unit})` : ""}`)
              .join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

function FlyTo({ point }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([point.lat, point.lng], 18, { duration: 0.8 });
  }, [point, map]);
  return null;
}

// One shared AudioContext, unlocked by the first click anywhere on the page
// (browsers refuse to play sound before that).
let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}
if (typeof window !== "undefined") {
  const unlock = () => {
    try {
      getAudio()?.resume();
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function beep() {
  try {
    const ctx = getAudio();
    if (!ctx || ctx.state !== "running") return false;
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = t === 0.25 ? 660 : 880;
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.18);
    });
    return true;
  } catch {
    return false;
  }
}

// Red banner on every admin tab while an SOS is unresolved. Polls every 3 s,
// sounds the alarm every 4 s until the SOS is acknowledged, and turns the
// browser tab title into a flashing warning so it is noticed from another tab.
function SosBanner({ onOpen, onChanged }) {
  const [alerts, setAlerts] = useState([]);
  const [muted, setMuted] = useState(false);
  const [soundOk, setSoundOk] = useState(true);
  const [, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      setAlerts(await getAlerts());
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    const tk = setInterval(() => setNow((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      clearInterval(tk);
    };
  }, [load]);

  const [busy, setBusy] = useState("");
  const act = async (id, action, note) => {
    setBusy(id);
    try {
      await updateReport(id, action, note);
    } catch {
      /* the next refresh shows the real state */
    }
    setBusy("");
    load();
    onChanged?.();
  };

  const sos = alerts.filter((a) => a.kind === "sos");
  const unanswered = sos.filter((a) => a.status === "open");

  // alarm while any SOS is still unanswered
  useEffect(() => {
    if (unanswered.length === 0 || muted) return;
    const ring = () => setSoundOk(beep());
    ring();
    const id = setInterval(ring, 4000);
    return () => clearInterval(id);
  }, [unanswered.length, muted]);

  // a new unanswered SOS un-mutes the alarm
  const newest = unanswered[0]?._id;
  useEffect(() => {
    if (newest) setMuted(false);
  }, [newest]);

  // flashing tab title
  useEffect(() => {
    if (unanswered.length === 0) return;
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `SOS! (${unanswered.length}) ` : original;
    }, 800);
    return () => {
      clearInterval(id);
      document.title = original;
    };
  }, [unanswered.length]);

  if (sos.length === 0) return null;
  const waited = (iso) => {
    const s = Math.max(
      0,
      Math.round((Date.now() - new Date(iso).getTime()) / 1000),
    );
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    if (s < 86400)
      return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  };

  return (
    <div
      role="alert"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2000,
        background: unanswered.length ? "#B91C1C" : "#92400E",
        color: "#fff",
        padding: "10px clamp(12px,4vw,24px)",
        fontFamily: GR,
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
        animation: unanswered.length ? "gvSosPulse 1s infinite" : "none",
      }}
    >
      <style>{`@keyframes gvSosPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}`}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <b style={{ fontSize: 15 }}>
          {unanswered.length
            ? `SOS - ${unanswered.length} need${unanswered.length === 1 ? "s" : ""} a response`
            : `SOS - ${sos.length} being handled`}
        </b>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {unanswered.length > 0 && (
            <button
              onClick={() => setMuted(true)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #fff",
                background: "transparent",
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {muted ? "Alarm muted" : "Mute alarm"}
            </button>
          )}
          <button
            onClick={onOpen}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: "#fff",
              color: "#B91C1C",
              fontFamily: GR,
              fontWeight: 800,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            Open incidents
          </button>
        </span>
      </div>
      {sos.slice(0, 3).map((a) => (
        <div key={a._id} style={{ fontSize: 13, marginTop: 4 }}>
          <b>{a.reporter?.name || "Unknown"}</b> ({a.reporter?.role}
          {a.reporter?.unit ? ` · ${a.reporter.unit}` : ""}) ·{" "}
          {a.status === "open" ? "waiting " : "acknowledged · "}
          {waited(a.ts)}
          {a.reporter?.phone && (
            <>
              {" · "}
              <a
                href={`tel:${a.reporter.phone}`}
                style={{ color: "#fff", fontWeight: 800 }}
              >
                {a.reporter.phone}
              </a>
            </>
          )}
          {!a.hasLocation && " · no location"}
          <span style={{ display: "inline-flex", gap: 6, marginLeft: 10 }}>
            {a.status === "open" && (
              <button
                disabled={busy === a._id}
                onClick={() => act(a._id, "ack", "Papunta na ang tulong")}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "#fff",
                  color: "#B91C1C",
                  fontFamily: GR,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Papunta na kami
              </button>
            )}
            <button
              disabled={busy === a._id}
              onClick={() => {
                const note = window.prompt("Resolution note (optional)", "");
                if (note !== null) act(a._id, "resolve", note);
              }}
              style={{
                padding: "3px 10px",
                borderRadius: 6,
                border: "1px solid #fff",
                background: "transparent",
                color: "#fff",
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Resolve
            </button>
          </span>
        </div>
      ))}
      {unanswered.length > 0 && !soundOk && !muted && (
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
          Click anywhere on this page to turn on the alarm sound.
        </div>
      )}
    </div>
  );
}

function IncidentsTab({ items, loading, onChanged }) {
  const [err, setErr] = useNotice("");
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("open");

  const shown = items.filter((x) =>
    filter === "all"
      ? true
      : filter === "open"
        ? x.status !== "resolved"
        : x.status === "resolved",
  );

  const act = async (id, action) => {
    setBusy(id + action);
    try {
      await updateReport(id, action, notes[id] || "");
      onChanged();
    } catch (e) {
      setErr(e.message || "Failed");
    }
    setBusy("");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          ["open", "Open"],
          ["resolved", "Resolved"],
          ["all", "All"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              background: filter === k ? C.navy : C.white,
              color: filter === k ? "#fff" : C.text,
              fontFamily: GR,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {err && (
        <div
          style={{
            color: "#B91C1C",
            fontFamily: GR,
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      {loading && (
        <div style={{ fontFamily: GR, color: C.muted }}>Loading...</div>
      )}
      {!loading && shown.length === 0 && (
        <div
          style={{
            fontFamily: GR,
            color: C.muted,
            padding: 24,
            textAlign: "center",
          }}
        >
          No reports here.
        </div>
      )}
      {shown.map((r) => {
        const sos = r.kind === "sos";
        return (
          <div
            key={r._id}
            style={{
              background: C.white,
              border: `1px solid ${sos && r.status === "open" ? "#DC2626" : C.border}`,
              borderLeft: `5px solid ${sos ? "#DC2626" : "#F59E0B"}`,
              borderRadius: 12,
              padding: 14,
              marginBottom: 12,
              fontFamily: GR,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <b style={{ fontSize: 14, color: C.text }}>{r._id}</b>
              <Badge variant={sos ? "red" : "yellow"}>{r.categoryLabel}</Badge>
              <Badge
                variant={
                  r.status === "open"
                    ? "red"
                    : r.status === "acknowledged"
                      ? "blue"
                      : "green"
                }
              >
                {r.status}
              </Badge>
              <span
                style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted }}
              >
                {new Date(r.ts).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 8 }}>
              <b>{r.reporter?.name || "Unknown"}</b> ({r.reporter?.role})
              {r.reporter?.phone && (
                <>
                  {" · "}
                  <a
                    href={`tel:${r.reporter.phone}`}
                    style={{ color: C.navy, fontWeight: 700 }}
                  >
                    {r.reporter.phone}
                  </a>
                </>
              )}
              {r.reporter?.unit && <> · Unit {r.reporter.unit}</>}
              {r.reporter?.plate && <> · {r.reporter.plate}</>}
            </div>
            {r.description && (
              <div
                style={{
                  fontSize: 13,
                  color: C.text,
                  marginTop: 6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.description}
              </div>
            )}
            {r.ride && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                Ride {r.ride.id} ({r.ride.status}) · Driver:{" "}
                {r.ride.driver || "-"} {r.ride.unit || ""} · Passenger:{" "}
                {r.ride.passengerName || "-"} · {r.ride.pickup || "?"} →{" "}
                {r.ride.dropoff || "?"}
              </div>
            )}
            <div style={{ fontSize: 12, marginTop: 6 }}>
              {r.location ? (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${r.location.lat}&mlon=${r.location.lng}#map=18/${r.location.lat}/${r.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.navy, fontWeight: 700 }}
                >
                  View location on map
                </a>
              ) : (
                <span style={{ color: C.muted }}>No location shared</span>
              )}
            </div>
            {r.resolutionNote && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                Note: {r.resolutionNote}
              </div>
            )}
            {r.status !== "resolved" && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 10,
                  flexWrap: "wrap",
                }}
              >
                <input
                  value={notes[r._id] || ""}
                  maxLength={400}
                  onChange={(e) =>
                    setNotes({ ...notes, [r._id]: e.target.value })
                  }
                  placeholder="Note (optional)"
                  style={{
                    flex: "1 1 160px",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    fontFamily: GR,
                    fontSize: 13,
                  }}
                />
                {r.status === "open" && (
                  <button
                    disabled={!!busy}
                    onClick={() => act(r._id, "ack")}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: `1px solid ${C.navy}`,
                      background: C.white,
                      color: C.navy,
                      fontFamily: GR,
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Acknowledge
                  </button>
                )}
                <button
                  disabled={!!busy}
                  onClick={() => act(r._id, "resolve")}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: C.navy,
                    color: "#fff",
                    fontFamily: GR,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Resolve
                </button>
              </div>
            )}
          </div>
        );
      })}
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
  const [error, setError] = useNotice(null);
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

const DURATION_UNITS = [
  ["seconds", 1],
  ["minutes", 60],
  ["hours", 3600],
  ["days", 86400],
];

// "2m 05s left", "1h 03m left", "Expired"
function timeLeftText(until, nowMs) {
  const ms = new Date(until).getTime() - nowMs;
  if (ms <= 0) return null;
  const t = Math.ceil(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m left`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s left`;
  return `${sec}s left`;
}

// Per-account temporary access: live countdown, and the admin can set how much
// time THIS account has left (counted from now), or expire it right away.
function TempAccessControl({ p, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useNotice("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(60);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = p.tempAccessUntil ? timeLeftText(p.tempAccessUntil, now) : null;
  const expired = p.tempAccessUntil && !left;
  const run = async (seconds) => {
    setBusy(true);
    setErr("");
    try {
      await setTimeLeft(p._id, seconds);
      setValue("");
      onChanged();
    } catch (e) {
      setErr(cleanErr(e));
    }
    setBusy(false);
  };
  const secs = Math.round(Number(value) * unit);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        marginTop: 4,
        fontFamily: IN,
        fontSize: 11.5,
      }}
    >
      <span
        style={{
          color: expired ? "#B91C1C" : C.text,
          fontWeight: 700,
          minWidth: 96,
        }}
      >
        {!p.tempAccessUntil
          ? "No time limit"
          : expired
            ? "Access expired"
            : left}
      </span>
      <span style={{ color: C.muted }}>Set time left:</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ ...fieldStyle, width: 64, padding: "4px 6px", fontSize: 11.5 }}
      />
      <select
        value={unit}
        onChange={(e) => setUnit(Number(e.target.value))}
        style={{ ...fieldStyle, padding: "4px 6px", fontSize: 11.5 }}
      >
        {DURATION_UNITS.map(([label, m]) => (
          <option key={label} value={m}>
            {label}
          </option>
        ))}
      </select>
      <button
        disabled={busy || value === "" || !(secs >= 0)}
        onClick={() => run(secs)}
        style={{
          ...smallBtn(C.navy, "#fff"),
          opacity: busy || value === "" || !(secs >= 0) ? 0.5 : 1,
        }}
      >
        Set
      </button>
      <button
        disabled={busy || expired}
        onClick={() => run(0)}
        style={{
          ...smallBtn("#FEE2E2", "#991B1B"),
          opacity: busy || expired ? 0.5 : 1,
        }}
      >
        Expire now
      </button>
      {err && <span style={{ color: "#B91C1C" }}>{err}</span>}
    </div>
  );
}

// All registered users: passengers (from the server) and drivers.
function UsersTab() {
  const [passengers, setPassengers] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | passenger | driver
  const [q, setQ] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([getPassengers(), getDrivers()]);
      setPassengers(p);
      setDrivers(d);
    } catch {
      /* keep last known list */
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  const rows = [
    ...passengers.map((p) => ({
      key: p._id,
      type: "passenger",
      name: p.name,
      username: p.username,
      contact: p.phone || "",
      address: p.address || "",
      status: p.status,
      discount: p.discountType ? discountLabel(p.discountType) : "",
      tempAccessUntil: p.tempAccessUntil,
      joined: p.createdAt,
    })),
    ...drivers.map((d) => ({
      key: d._id,
      type: "driver",
      name: d.name,
      username: d._id,
      contact: d.contact || "",
      address: d.unit ? `Unit ${d.unit} · ${d.plate || ""}` : "No unit",
      status: d.appActive ? "active" : "off duty",
      discount: "",
      joined: null,
    })),
  ]
    .filter((r) => filter === "all" || r.type === filter)
    .filter((r) => {
      const t = q.trim().toLowerCase();
      return (
        !t ||
        [r.name, r.username, r.contact, r.address]
          .join(" ")
          .toLowerCase()
          .includes(t)
      );
    });

  const statusBadgeFor = (r) => {
    if (r.type === "driver")
      return (
        <Badge variant={r.status === "active" ? "green" : "gray"}>
          {r.status === "active" ? "Active" : "Off duty"}
        </Badge>
      );
    if (r.status === "pending") {
      const left = r.tempAccessUntil
        ? timeLeftText(r.tempAccessUntil, now)
        : null;
      return (
        <div>
          <Badge variant="yellow">Unverified</Badge>
          <div
            style={{
              fontFamily: IN,
              fontSize: 10.5,
              marginTop: 3,
              color: left ? C.muted : "#B91C1C",
            }}
          >
            {r.tempAccessUntil
              ? left
                ? `Temp access: ${left}`
                : "Temp access expired"
              : ""}
          </div>
        </div>
      );
    }
    if (r.status === "rejected") return <Badge variant="red">Rejected</Badge>;
    return <Badge variant="green">Verified</Badge>;
  };

  const th = {
    padding: "10px 16px",
    textAlign: "left",
    fontSize: 11,
    fontFamily: GR,
    fontWeight: 600,
    color: C.muted,
    textTransform: "uppercase",
  };
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
        <span
          style={{
            fontFamily: GR,
            fontWeight: 700,
            fontSize: 14,
            color: C.text,
          }}
        >
          All users ({rows.length})
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            ["all", "All"],
            ["passenger", `Passengers (${passengers.length})`],
            ["driver", `Drivers (${drivers.length})`],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={smallBtn(
                filter === k ? C.navy : C.surface,
                filter === k ? "#fff" : C.text,
              )}
            >
              {label}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, username, address"
            style={{ ...fieldStyle, width: 210 }}
          />
        </div>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background: C.surface }}>
            {[
              "Name",
              "Type",
              "Username",
              "Contact",
              "Address / Unit",
              "Discount",
              "Status",
              "Joined",
            ].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td
                colSpan={8}
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
          {!loading && rows.length === 0 && (
            <tr>
              <td
                colSpan={8}
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: C.muted,
                  fontFamily: IN,
                  fontSize: 13,
                }}
              >
                No users found
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr
              key={r.type + r.key}
              style={{
                borderTop: `1px solid ${C.border}`,
                background: i % 2 === 0 ? C.white : "#FAFAF8",
              }}
            >
              <td
                data-label="Name"
                style={{
                  padding: "11px 16px",
                  fontFamily: GR,
                  fontWeight: 600,
                  fontSize: 13,
                  color: C.text,
                }}
              >
                {r.name}
              </td>
              <td data-label="Type" style={{ padding: "11px 16px" }}>
                <Badge variant={r.type === "driver" ? "blue" : "gray"}>
                  {r.type === "driver" ? "Driver" : "Passenger"}
                </Badge>
              </td>
              <td
                data-label="Username"
                style={{
                  padding: "11px 16px",
                  fontFamily: IN,
                  fontSize: 12,
                  color: C.muted,
                }}
              >
                {r.type === "driver" ? r.username : `@${r.username}`}
              </td>
              <td
                data-label="Contact"
                style={{
                  padding: "11px 16px",
                  fontFamily: IN,
                  fontSize: 12,
                  color: C.text,
                }}
              >
                {r.contact || "-"}
              </td>
              <td
                data-label="Address / Unit"
                style={{
                  padding: "11px 16px",
                  fontFamily: IN,
                  fontSize: 12,
                  color: C.text,
                }}
              >
                {r.address || "-"}
              </td>
              <td
                data-label="Discount"
                style={{
                  padding: "11px 16px",
                  fontFamily: IN,
                  fontSize: 12,
                  color: C.text,
                }}
              >
                {r.discount || "-"}
              </td>
              <td data-label="Status" style={{ padding: "11px 16px" }}>
                {statusBadgeFor(r)}
              </td>
              <td
                data-label="Joined"
                style={{
                  padding: "11px 16px",
                  fontFamily: IN,
                  fontSize: 12,
                  color: C.muted,
                }}
              >
                {r.joined
                  ? new Date(r.joined).toLocaleDateString("en-PH")
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
            <TempAccessControl p={p} onChanged={onChanged} />
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
  const [userStats, setUserStats] = useState(null);
  const [reports, setReports] = useState([]);
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
    try {
      setUserStats(await getUserStats());
    } catch {
      /* keep last known counts */
    }
    try {
      setReports(await getReports());
    } catch {
      /* keep last known reports */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 8000);
    return () => clearInterval(id);
  }, [loadAll]);

  const waiting = logs.filter((x) => x.status === "pending");
  const openReports = reports.filter((x) => x.status === "open").length;

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
      label: "Total Users",
      value: userStats ? userStats.total : "-",
      sub: userStats
        ? `${userStats.passengers} passengers (${userStats.pending} unverified) · ${userStats.drivers} drivers`
        : "loading...",
    },
  ];

  return (
    <div style={{ height: "100%", background: C.surface, overflowY: "auto" }}>
      <SosBanner onOpen={() => setTab("incidents")} onChanged={loadAll} />
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
            ["users", "Users"],
            ["verify", "Verify"],
            ["map", "Map"],
            ["attendance", "Attendance"],
            ["override", "Override"],
            ["incidents", "Incidents"],
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
              {key === "override" && waiting.length > 0 && (
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
                  {waiting.length}
                </span>
              )}
              {key === "incidents" && openReports > 0 && (
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
                  {openReports}
                </span>
              )}
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
        {tab === "users" && <UsersTab />}
        {tab === "verify" && (
          <VerifyTab items={verifs} loading={loading} onChanged={loadAll} />
        )}
        {tab === "map" && <DriversMapTab />}
        {tab === "attendance" && <AttendanceTab drivers={drivers} />}
        {tab === "override" && (
          <OverrideTab
            waiting={waiting}
            drivers={drivers}
            loading={loading}
            onChanged={loadAll}
          />
        )}
        {tab === "incidents" && (
          <IncidentsTab items={reports} loading={loading} onChanged={loadAll} />
        )}
        {tab === "log" && <LogTab logs={logs} loading={loading} />}
      </div>
    </div>
  );
}
