import { useState, useEffect, useRef } from "react";
import { Clock, ArrowRight, Truck, X, AlertCircle } from "lucide-react";
import { C, GR, IN, TERMINALS, INIT_TRICYCLES, getTerm, getFare, genId, fmtTime, Logo } from "./shared.jsx";

function Badge({ children, variant = "gray" }) {
  const map = {
    green:  { bg:"#D1FAE5", fg:"#065F46" },
    blue:   { bg:"#DBEAFE", fg:"#1E40AF" },
    yellow: { bg:"#FEF3C7", fg:"#92400E" },
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
    available: ["green","● Available"], on_trip:    ["blue","● On Trip"],
    off_duty:  ["gray","Off Duty"],      dispatched: ["blue","● Dispatched"],
    completed: ["green","Completed"],
  };
  const [v, label] = m[s] || ["gray", s];
  return <Badge variant={v}>{label}</Badge>;
}

function RequestCard({ req, onAssign }) {
  const wait = Math.round((Date.now() - new Date(req.ts).getTime()) / 60000);
  return (
    <div style={{ background:C.white, borderRadius:12, padding:"14px 16px",
      border:`1px solid ${C.border}`, boxShadow:"0 1px 4px rgba(0,0,0,0.05)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontFamily:"monospace", fontSize:11, background:C.surface,
            borderRadius:5, padding:"2px 6px", color:C.muted }}>{req.id}</span>
          <Badge variant="yellow">● Pending</Badge>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4, color:C.muted, fontSize:12, fontFamily:IN }}>
          <Clock size={12} /> {wait === 0 ? "Just now" : `${wait}m ago`}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 auto", minWidth:100 }}>
          <div style={{ fontSize:10, color:C.muted, fontFamily:IN, textTransform:"uppercase" }}>From</div>
          <div style={{ fontWeight:600, fontFamily:GR, fontSize:13, color:C.text }}>{getTerm(req.origin)?.name}</div>
        </div>
        <ArrowRight size={14} color={C.muted} />
        <div style={{ flex:"1 1 auto", minWidth:100, textAlign:"right" }}>
          <div style={{ fontSize:10, color:C.muted, fontFamily:IN, textTransform:"uppercase" }}>To</div>
          <div style={{ fontWeight:600, fontFamily:GR, fontSize:13, color:C.navy }}>{getTerm(req.destination)?.name}</div>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontWeight:700, fontFamily:GR, fontSize:15, color:C.green }}>₱{req.fare}.00</span>
        <button onClick={onAssign}
          style={{ background:C.navy, color:"#fff", border:"none", borderRadius:8,
            padding:"8px 16px", fontFamily:GR, fontSize:13, fontWeight:600, cursor:"pointer" }}>
          Assign Tricycle
        </button>
      </div>
    </div>
  );
}

function DispatchedCard({ log }) {
  return (
    <div style={{ background:C.white, borderRadius:12, padding:"12px 16px", border:`1px solid ${C.border}` }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <span style={{ fontFamily:"monospace", fontSize:11, background:C.surface,
          borderRadius:5, padding:"2px 6px", color:C.muted }}>{log.id}</span>
        {statusBadge(log.status)}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
        <span style={{ fontSize:13, fontFamily:GR, color:C.text, fontWeight:600 }}>{getTerm(log.origin)?.short}</span>
        <ArrowRight size={12} color={C.muted} />
        <span style={{ fontSize:13, fontFamily:GR, color:C.navy, fontWeight:600 }}>{getTerm(log.destination)?.short}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.muted, fontFamily:IN, flexWrap:"wrap", gap:4 }}>
        <span>{log.driver} · {log.unit}</span>
        <span>{fmtTime(log.ts)}</span>
      </div>
    </div>
  );
}

export default function DispatcherView({ dispatchLog, setDispatchLog }) {
  const DISP = "T1";
  const [pending, setPending] = useState([
    { id:"RQ-001", origin:"T4", destination:"T1", fare:getFare("T4","T1"), ts:new Date(Date.now()-90000).toISOString() },
    { id:"RQ-002", origin:"T3", destination:"T1", fare:getFare("T3","T1"), ts:new Date(Date.now()-35000).toISOString() },
  ]);
  const [modal, setModal] = useState(null);
  const [tricycles, setTricycles] = useState([...INIT_TRICYCLES]);
  const [newAlert, setNewAlert] = useState(false);
  const simIdx = useRef(0);
  const SIMS = [
    { origin:"T2", destination:"T1" }, { origin:"T4", destination:"T3" },
    { origin:"T3", destination:"T1" }, { origin:"T2", destination:"T4" },
  ];

  useEffect(() => {
    const tid = setInterval(() => {
      const sim = SIMS[simIdx.current % SIMS.length]; simIdx.current++;
      const rq = { id:`RQ-${String(simIdx.current+2).padStart(3,"0")}`,
        origin:sim.origin, destination:sim.destination,
        fare:getFare(sim.origin, sim.destination), ts:new Date().toISOString() };
      setPending(p => [rq, ...p]);
      setNewAlert(true);
      setTimeout(() => setNewAlert(false), 3000);
    }, 12000);
    return () => clearInterval(tid);
  }, []);

  const available = tricycles.filter(t => t.status === "available" && t.terminal === DISP);
  const selectedReq = modal ? pending.find(r => r.id === modal) : null;

  const handleAssign = (reqId, tri) => {
    const req = pending.find(r => r.id === reqId); if (!req) return;
    const log = { id:genId(), origin:req.origin, destination:req.destination,
      driver:tri.driver, unit:tri.id, plate:tri.plate,
      fare:req.fare, ts:new Date().toISOString(), status:"dispatched" };
    setDispatchLog(p => [log, ...p]);
    setPending(p => p.filter(r => r.id !== reqId));
    setTricycles(p => p.map(t => t.id === tri.id ? { ...t, status:"on_trip", terminal:null } : t));
    setModal(null);
  };

  return (
    <div style={{ minHeight:"100%", background:C.surface, overflowY:"auto" }}>
      <div style={{ background:C.navy, padding:"14px clamp(12px,4vw,24px)", display:"flex",
        alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <Logo size={24} />
          <div style={{ width:1, height:26, background:"rgba(255,255,255,0.15)" }} className="hide-xs" />
          <div className="hide-xs">
            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:GR, letterSpacing:1.5, textTransform:"uppercase" }}>Dispatcher</div>
            <div style={{ color:"#fff", fontWeight:700, fontFamily:GR, fontSize:14 }}>{getTerm(DISP)?.name}</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ position:"relative" }}>
            <div style={{ width:34, height:34, borderRadius:9, background:"rgba(255,255,255,0.08)",
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <AlertCircle size={15} color="rgba(255,255,255,0.5)" />
            </div>
            {newAlert && <div style={{ position:"absolute", top:-3, right:-3, width:14, height:14,
              borderRadius:"50%", background:C.danger, fontSize:8, fontWeight:700, color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center" }}>!</div>}
          </div>
          <div style={{ background:C.green, padding:"6px 12px", borderRadius:8,
            color:"#fff", fontFamily:GR, fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>
            {available.length} Available
          </div>
        </div>
      </div>

      <div style={{ background:C.navyLight, padding:"10px clamp(12px,4vw,24px)", display:"flex", gap:"clamp(16px,5vw,32px)", overflowX:"auto" }}>
        {[["Pending", pending.length, pending.length > 0],
          ["Available", available.length, false],
          ["Dispatched Today", dispatchLog.length, false]
        ].map(([label, val, accent]) => (
          <div key={label} style={{ flexShrink:0 }}>
            <div style={{ color:"rgba(255,255,255,0.4)", fontFamily:IN, fontSize:10, letterSpacing:1, textTransform:"uppercase", whiteSpace:"nowrap" }}>{label}</div>
            <div style={{ color:accent ? C.yellow : "#fff", fontFamily:GR, fontSize:19, fontWeight:700 }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="dispatcher-grid" style={{ padding:"clamp(12px,3vw,20px)", display:"grid",
        gridTemplateColumns:"1fr 1fr", gap:20, maxWidth:960, margin:"0 auto" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <h3 style={{ color:C.text, fontFamily:GR, fontSize:14, fontWeight:700, margin:0 }}>
              Incoming Requests
              {pending.length > 0 && (
                <span style={{ marginLeft:6, background:C.danger, color:"#fff",
                  borderRadius:10, padding:"1px 7px", fontSize:11 }}>{pending.length}</span>
              )}
            </h3>
            <span style={{ fontSize:11, color:C.muted, fontFamily:IN }}>Live · +1/12s</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {pending.length === 0 && (
              <div style={{ background:C.white, borderRadius:12, padding:"32px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
                <p style={{ color:C.muted, fontFamily:IN, fontSize:13, margin:0 }}>All requests fulfilled ✓</p>
              </div>
            )}
            {pending.map(req => <RequestCard key={req.id} req={req} onAssign={() => setModal(req.id)} />)}
          </div>
        </div>

        <div>
          <h3 style={{ color:C.text, fontFamily:GR, fontSize:14, fontWeight:700, margin:"0 0 12px" }}>Recent Dispatches</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {dispatchLog.length === 0 && (
              <div style={{ background:C.white, borderRadius:12, padding:"32px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
                <p style={{ color:C.muted, fontFamily:IN, fontSize:13, margin:0 }}>No dispatches yet</p>
              </div>
            )}
            {dispatchLog.slice(0, 5).map(log => <DispatchedCard key={log.id} log={log} />)}
          </div>
        </div>
      </div>

      {modal && selectedReq && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex",
          alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 }}>
          <div style={{ background:C.white, borderRadius:18, width:"100%", maxWidth:420,
            overflow:"hidden", boxShadow:"0 24px 80px rgba(0,0,0,0.3)", maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ background:C.navy, padding:"16px 20px", display:"flex",
              justifyContent:"space-between", alignItems:"center", position:"sticky", top:0 }}>
              <span style={{ color:"#fff", fontFamily:GR, fontWeight:700, fontSize:14 }}>Assign a Tricycle</span>
              <button onClick={() => setModal(null)}
                style={{ background:"transparent", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding:"16px 20px" }}>
              <div style={{ background:C.surface, borderRadius:10, padding:"12px 14px",
                marginBottom:16, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:11, color:C.muted, fontFamily:IN }}>
                  <strong style={{ color:C.text }}>{selectedReq.id}</strong>
                </span>
                <div style={{ display:"flex", alignItems:"center", gap:6, fontFamily:GR, fontSize:13 }}>
                  <span style={{ fontWeight:600, color:C.text }}>{getTerm(selectedReq.origin)?.short}</span>
                  <ArrowRight size={13} color={C.muted} />
                  <span style={{ fontWeight:600, color:C.navy }}>{getTerm(selectedReq.destination)?.short}</span>
                </div>
                <span style={{ marginLeft:"auto", fontWeight:700, fontFamily:GR, color:C.green }}>₱{selectedReq.fare}</span>
              </div>
              <p style={{ color:C.muted, fontFamily:IN, fontSize:12, margin:"0 0 10px" }}>Available at this terminal:</p>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {available.map(tri => (
                  <button key={tri.id} onClick={() => handleAssign(selectedReq.id, tri)}
                    style={{ background:C.surface, border:`2px solid ${C.border}`, borderRadius:12,
                      padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:34, height:34, borderRadius:8, background:C.navy,
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <Truck size={15} color={C.yellow} />
                      </div>
                      <div style={{ textAlign:"left" }}>
                        <div style={{ fontWeight:700, fontFamily:GR, color:C.text, fontSize:13 }}>{tri.id}</div>
                        <div style={{ fontSize:11.5, color:C.muted, fontFamily:IN }}>{tri.driver} · {tri.plate}</div>
                      </div>
                    </div>
                    <span style={{ fontSize:12.5, fontFamily:GR, fontWeight:600, color:C.green, whiteSpace:"nowrap" }}>Assign →</span>
                  </button>
                ))}
                {available.length === 0 && (
                  <p style={{ textAlign:"center", color:C.muted, fontFamily:IN, fontSize:13, padding:"16px 0" }}>
                    No available tricycles at this terminal
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
