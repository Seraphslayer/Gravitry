import { useState } from "react";
import { Truck, Plus, Star } from "lucide-react";
import { C, GR, IN, TERMINALS, INIT_DRIVERS, INIT_TRICYCLES, FARES, getTerm, fmtTime, getDocStatus, Logo } from "./shared.jsx";

function Badge({ children, variant = "gray" }) {
  const map = {
    green:  { bg:"#D1FAE5", fg:"#065F46" },
    blue:   { bg:"#DBEAFE", fg:"#1E40AF" },
    gray:   { bg:"#F3F4F6", fg:"#374151" },
  };
  const { bg, fg } = map[variant] || map.gray;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px",
      borderRadius:20, fontSize:11, fontWeight:600, fontFamily:GR, background:bg, color:fg }}>
      {children}
    </span>
  );
}

function statusBadge(s) {
  const m = {
    available: ["green","● Available"], on_trip: ["blue","● On Trip"], off_duty: ["gray","Off Duty"],
  };
  const [v, label] = m[s] || ["gray", s];
  return <Badge variant={v}>{label}</Badge>;
}

function DocBadge({ label, status }) {
  const map = {
    red:    { bg:"#FEE2E2", fg:"#991B1B" },
    yellow: { bg:"#FEF3C7", fg:"#92400E" },
    green:  { bg:"#D1FAE5", fg:"#065F46" },
  };
  const { bg, fg } = map[status.variant];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10.5, fontFamily:IN, marginBottom:2 }}>
      <span style={{ color:C.muted, minWidth:52 }}>{label}</span>
      <span style={{ background:bg, color:fg, borderRadius:8, padding:"1px 7px", fontWeight:700, fontFamily:GR, fontSize:10 }}>
        {status.label}
      </span>
    </div>
  );
}

function DriversTab() {
  return (
    <div style={{ background:C.white, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden" }}>
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <span style={{ fontFamily:GR, fontWeight:700, fontSize:14, color:C.text }}>Registered Drivers</span>
        <button style={{ display:"flex", alignItems:"center", gap:6, background:C.navy, color:"#fff",
          border:"none", borderRadius:8, padding:"7px 14px", fontFamily:GR, fontSize:12, fontWeight:600, cursor:"pointer" }}>
          <Plus size={14} /> Add Driver
        </button>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background:C.surface }}>
            {["Driver","License No.","Contact","Assigned Unit","Rating","Documents","Status"].map(h => (
              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11,
                fontFamily:GR, fontWeight:600, color:C.muted, textTransform:"uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INIT_DRIVERS.map((d, i) => (
            <tr key={d.id} style={{ borderTop:`1px solid ${C.border}`, background:i%2===0?C.white:"#FAFAF8" }}>
              <td data-label="Driver" style={{ padding:"12px 16px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:30, height:30, borderRadius:8, background:C.navy, display:"flex",
                    alignItems:"center", justifyContent:"center", color:C.yellow, fontFamily:GR, fontWeight:700, fontSize:11, flexShrink:0 }}>
                    {d.name.split(" ").slice(0,2).map(p=>p[0]).join("")}
                  </div>
                  <span style={{ fontFamily:GR, fontWeight:600, fontSize:13, color:C.text }}>{d.name}</span>
                </div>
              </td>
              <td data-label="License No." style={{ padding:"12px 16px", fontFamily:"monospace", fontSize:12, color:C.muted }}>{d.license}</td>
              <td data-label="Contact" style={{ padding:"12px 16px", fontFamily:IN, fontSize:12, color:C.text }}>{d.contact}</td>
              <td data-label="Unit" style={{ padding:"12px 16px", fontFamily:"monospace", fontSize:13, fontWeight:700, color:C.text }}>{d.unit}</td>
              <td data-label="Rating" style={{ padding:"12px 16px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <Star size={13} color={C.yellow} fill={C.yellow} />
                  <span style={{ fontFamily:GR, fontWeight:700, fontSize:13, color:C.text }}>{d.rating}</span>
                  <span style={{ fontFamily:IN, fontSize:10.5, color:C.muted }}>({d.tripsCompleted})</span>
                </div>
              </td>
              <td data-label="Documents" style={{ padding:"12px 16px" }}>
                <DocBadge label="License" status={getDocStatus(d.licenseExpiry)} />
                <DocBadge label="Franchise" status={getDocStatus(d.franchiseExpiry)} />
              </td>
              <td data-label="Status" style={{ padding:"12px 16px" }}>{statusBadge(d.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TricyclesTab() {
  return (
    <div style={{ background:C.white, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden" }}>
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <span style={{ fontFamily:GR, fontWeight:700, fontSize:14, color:C.text }}>Registered Tricycles</span>
        <button style={{ display:"flex", alignItems:"center", gap:6, background:C.navy, color:"#fff",
          border:"none", borderRadius:8, padding:"7px 14px", fontFamily:GR, fontSize:12, fontWeight:600, cursor:"pointer" }}>
          <Plus size={14} /> Register Unit
        </button>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background:C.surface }}>
            {["Unit No.","Plate No.","Driver","Terminal","Status"].map(h => (
              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11,
                fontFamily:GR, fontWeight:600, color:C.muted, textTransform:"uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {INIT_TRICYCLES.map((t, i) => (
            <tr key={t.id} style={{ borderTop:`1px solid ${C.border}`, background:i%2===0?C.white:"#FAFAF8" }}>
              <td data-label="Unit" style={{ padding:"12px 16px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:30, height:30, borderRadius:8, background:C.navy,
                    display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Truck size={14} color={C.yellow} />
                  </div>
                  <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:13, color:C.text }}>{t.id}</span>
                </div>
              </td>
              <td data-label="Plate" style={{ padding:"12px 16px", fontFamily:"monospace", fontSize:12, color:C.muted }}>{t.plate}</td>
              <td data-label="Driver" style={{ padding:"12px 16px", fontFamily:IN, fontSize:13, color:C.text }}>{t.driver}</td>
              <td data-label="Terminal" style={{ padding:"12px 16px", fontFamily:IN, fontSize:12, color:t.terminal?C.text:C.muted }}>
                {t.terminal ? getTerm(t.terminal)?.short : "—"}
              </td>
              <td data-label="Status" style={{ padding:"12px 16px" }}>{statusBadge(t.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FaresTab() {
  const [fares, setFares] = useState({ ...FARES });
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState("");

  const save = (key) => {
    const v = parseInt(editVal);
    if (!isNaN(v) && v > 0) setFares(p => ({ ...p, [key]: v }));
    setEditing(null);
  };

  return (
    <div>
      <div style={{ background:C.white, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden", marginBottom:12 }}>
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <span style={{ fontFamily:GR, fontWeight:700, fontSize:14, color:C.text }}>Fare Matrix</span>
          <span style={{ fontSize:11.5, color:C.muted, fontFamily:IN }}>Tap a cell to edit</span>
        </div>
        <div className="fare-matrix-wrap" style={{ overflowX:"auto", padding:"16px clamp(8px,3vw,20px)" }}>
          <table style={{ borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{ padding:"8px 12px", textAlign:"left", fontSize:12, fontFamily:GR,
                  fontWeight:700, color:C.muted, whiteSpace:"nowrap" }}>Origin / Dest</th>
                {TERMINALS.map(t => (
                  <th key={t.id} style={{ padding:"8px 14px", fontSize:12, fontFamily:GR,
                    fontWeight:700, color:C.navy, textAlign:"center", minWidth:74 }}>{t.short}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TERMINALS.map((origin, oi) => (
                <tr key={origin.id} style={{ background:oi%2===0?C.white:"#FAFAF8" }}>
                  <td style={{ padding:"8px 12px", fontFamily:GR, fontWeight:700, fontSize:12.5, color:C.navy, whiteSpace:"nowrap" }}>
                    {origin.short}
                  </td>
                  {TERMINALS.map(dest => {
                    const key  = `${origin.id}-${dest.id}`;
                    const same = origin.id === dest.id;
                    const isEdit = editing === key;
                    return (
                      <td key={dest.id} style={{ padding:"6px 8px", textAlign:"center" }}>
                        {same ? (
                          <span style={{ color:C.border, fontSize:14 }}>—</span>
                        ) : isEdit ? (
                          <div style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                            <input value={editVal} onChange={e => setEditVal(e.target.value)}
                              style={{ width:44, padding:"3px 5px", border:`2px solid ${C.green}`,
                                borderRadius:6, fontFamily:"monospace", fontSize:12, textAlign:"center", outline:"none" }}
                              autoFocus
                              onKeyDown={e => { if (e.key==="Enter") save(key); if (e.key==="Escape") setEditing(null); }}
                            />
                            <button onClick={() => save(key)}
                              style={{ background:C.green, color:"#fff", border:"none",
                                borderRadius:5, padding:"3px 7px", cursor:"pointer", fontSize:11 }}>✓</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditing(key); setEditVal(String(fares[key]||"")); }}
                            style={{ background:"#ECFDF5", border:"none", borderRadius:8, padding:"5px 10px",
                              fontFamily:GR, fontWeight:700, fontSize:12.5, color:C.greenDark, cursor:"pointer", minWidth:46 }}>
                            ₱{fares[key]}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize:11.5, color:C.muted, fontFamily:IN, margin:0 }}>
        ℹ️ Fare edits are versioned — previous rates are retained with their effective date range.
      </p>
    </div>
  );
}

function LogTab({ logs }) {
  return (
    <div style={{ background:C.white, borderRadius:12, border:`1px solid ${C.border}`, overflow:"hidden" }}>
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}` }}>
        <span style={{ fontFamily:GR, fontWeight:700, fontSize:14, color:C.text }}>Dispatch Log — Audit Trail</span>
      </div>
      <table className="responsive-table">
        <thead>
          <tr style={{ background:C.surface }}>
            {["ID","Route","Driver / Unit","Fare","Time"].map(h => (
              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11,
                fontFamily:GR, fontWeight:600, color:C.muted, textTransform:"uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 && (
            <tr><td colSpan={5} style={{ padding:"32px 16px", textAlign:"center", color:C.muted, fontFamily:IN, fontSize:13 }}>
              No dispatches yet.
            </td></tr>
          )}
          {logs.map((log, i) => (
            <tr key={log.id} style={{ borderTop:`1px solid ${C.border}`, background:i%2===0?C.white:"#FAFAF8" }}>
              <td data-label="ID" style={{ padding:"11px 16px", fontFamily:"monospace", fontSize:11, color:C.muted }}>{log.id}</td>
              <td data-label="Route" style={{ padding:"11px 16px", fontFamily:GR, fontSize:12, color:C.text, fontWeight:600 }}>
                {getTerm(log.origin)?.short} → {getTerm(log.destination)?.short}
              </td>
              <td data-label="Driver" style={{ padding:"11px 16px" }}>
                <div style={{ fontFamily:IN, fontSize:12, color:C.text }}>{log.driver}</div>
                <div style={{ fontFamily:"monospace", fontSize:11, color:C.muted }}>{log.unit} · {log.plate}</div>
              </td>
              <td data-label="Fare" style={{ padding:"11px 16px", fontFamily:GR, fontWeight:700, fontSize:13, color:C.green }}>₱{log.fare}.00</td>
              <td data-label="Time" style={{ padding:"11px 16px", fontFamily:IN, fontSize:12, color:C.muted }}>{fmtTime(log.ts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminView({ dispatchLog }) {
  const [tab, setTab] = useState("drivers");
  const stats = [
    { label:"Registered Drivers",  value:INIT_DRIVERS.length,   sub:`${INIT_DRIVERS.filter(d=>d.status==="available").length} available` },
    { label:"Tricycle Units",       value:INIT_TRICYCLES.length, sub:`${INIT_TRICYCLES.filter(t=>t.status==="available").length} at terminal` },
    { label:"Dispatch Log Entries", value:dispatchLog.length,    sub:"all time" },
    { label:"Terminal Coverage",    value:"4 / 4",               sub:"all active" },
  ];

  return (
    <div style={{ minHeight:"100%", background:C.surface, overflowY:"auto" }}>
      <div style={{ background:C.navy, padding:"14px clamp(12px,4vw,24px)", display:"flex", alignItems:"center", gap:14 }}>
        <Logo size={24} />
        <div style={{ width:1, height:26, background:"rgba(255,255,255,0.15)" }} className="hide-xs" />
        <div className="hide-xs">
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:GR, letterSpacing:1.5, textTransform:"uppercase" }}>Admin Dashboard</div>
          <div style={{ color:"#fff", fontWeight:700, fontFamily:GR, fontSize:14 }}>Mary Cris Complex TODA</div>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"clamp(12px,3vw,20px)" }}>
        <div className="admin-stats-grid" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
          {stats.map(s => (
            <div key={s.label} style={{ background:C.white, borderRadius:12, padding:"14px 16px", border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:"clamp(20px,5vw,26px)", fontWeight:700, fontFamily:GR, color:C.navy }}>{s.value}</div>
              <div style={{ fontSize:11.5, fontWeight:600, fontFamily:GR, color:C.text }}>{s.label}</div>
              <div style={{ fontSize:10.5, color:C.muted, fontFamily:IN }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", background:C.white, border:`1px solid ${C.border}`,
          borderRadius:12, overflow:"hidden", marginBottom:16, overflowX:"auto" }}>
          {[["drivers","Drivers"],["tricycles","Tricycles"],["fares","Fares"],["log","Log"]].map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex:"1 1 auto", minWidth:70, padding:"11px 8px", border:"none",
                borderBottom:tab===key ? `3px solid ${C.navy}` : "3px solid transparent",
                background:tab===key ? C.surface : "transparent",
                fontFamily:GR, fontSize:12.5, fontWeight:600,
                color:tab===key ? C.navy : C.muted, cursor:"pointer", whiteSpace:"nowrap" }}>
              {label}
            </button>
          ))}
        </div>

        {tab === "drivers"   && <DriversTab />}
        {tab === "tricycles" && <TricyclesTab />}
        {tab === "fares"     && <FaresTab />}
        {tab === "log"       && <LogTab logs={dispatchLog} />}
      </div>
    </div>
  );
}
