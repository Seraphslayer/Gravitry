import { useState } from "react";
import { MapPin, ArrowRight, Clock, CheckCircle, Power, Star, Truck } from "lucide-react";
import { C, GR, IN, INIT_DRIVERS, getTerm, fmtTime, genId, Logo } from "./shared.jsx";

// Simulated logged-in driver — in a real deployment this would come from auth
const ME = INIT_DRIVERS[0]; // Rolando Dela Cruz, unit MCC-001, home terminal T1
const HOME_TERMINAL = "T1";

function RequestCard({ req, onAccept }) {
  const wait = Math.round((Date.now() - new Date(req.ts).getTime()) / 60000);
  return (
    <div style={{ background:C.white, borderRadius:14, padding:"16px", border:`1px solid ${C.border}`,
      boxShadow:"0 1px 6px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <span style={{ fontFamily:"monospace", fontSize:11, background:C.surface,
          borderRadius:5, padding:"2px 7px", color:C.muted }}>{req.id}</span>
        <div style={{ display:"flex", alignItems:"center", gap:4, color:C.muted, fontSize:12, fontFamily:IN }}>
          <Clock size={12} /> {wait === 0 ? "Just now" : `${wait}m ago`}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10, color:C.muted, fontFamily:IN, textTransform:"uppercase" }}>Pickup</div>
          <div style={{ fontWeight:700, fontFamily:GR, fontSize:14, color:C.text }}>{getTerm(req.origin)?.name}</div>
        </div>
        <ArrowRight size={16} color={C.muted} />
        <div style={{ flex:1, textAlign:"right" }}>
          <div style={{ fontSize:10, color:C.muted, fontFamily:IN, textTransform:"uppercase" }}>Drop-off</div>
          <div style={{ fontWeight:700, fontFamily:GR, fontSize:14, color:C.navy }}>{getTerm(req.destination)?.name}</div>
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontWeight:700, fontFamily:GR, fontSize:18, color:C.green }}>₱{req.fare}.00</span>
        <button onClick={() => onAccept(req)}
          style={{ background:C.green, color:"#fff", border:"none", borderRadius:10,
            padding:"10px 20px", fontFamily:GR, fontSize:13.5, fontWeight:700, cursor:"pointer",
            display:"flex", alignItems:"center", gap:6, boxShadow:"0 3px 12px rgba(28,124,84,0.3)" }}>
          <CheckCircle size={15} /> Accept
        </button>
      </div>
    </div>
  );
}

export default function DriverView({ pendingRequests, setPendingRequests, dispatchLog, setDispatchLog }) {
  const [online, setOnline]     = useState(true);
  const [activeTrip, setActiveTrip] = useState(null);

  // Only show requests originating from this driver's home terminal
  const available = pendingRequests.filter(r => r.origin === HOME_TERMINAL);

  const handleAccept = (req) => {
    const log = {
      id: req.id, origin: req.origin, destination: req.destination,
      driver: ME.name, unit: ME.unit, plate: "ABL-1234",
      fare: req.fare, ts: new Date().toISOString(), status: "dispatched",
    };
    setDispatchLog(p => [log, ...p]);
    setPendingRequests(p => p.filter(r => r.id !== req.id));
    setActiveTrip(log);
  };

  const handleComplete = () => {
    setDispatchLog(p => p.map(l => l.id === activeTrip.id ? { ...l, status:"completed" } : l));
    setActiveTrip(null);
  };

  return (
    <div style={{ minHeight:"100%", background:C.surface, overflowY:"auto" }}>
      {/* Header */}
      <div style={{ background:C.navy, padding:"14px clamp(12px,4vw,24px)", display:"flex",
        alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <Logo size={24} />
          <div style={{ width:1, height:26, background:"rgba(255,255,255,0.15)" }} className="hide-xs" />
          <div className="hide-xs">
            <div style={{ color:"rgba(255,255,255,0.5)", fontSize:10, fontFamily:GR, letterSpacing:1.5, textTransform:"uppercase" }}>Driver</div>
            <div style={{ color:"#fff", fontWeight:700, fontFamily:GR, fontSize:14 }}>{ME.name} · {ME.unit}</div>
          </div>
        </div>
        <button onClick={() => setOnline(o => !o)}
          style={{ display:"flex", alignItems:"center", gap:8, background:online ? C.green : "rgba(255,255,255,0.1)",
            border:"none", borderRadius:20, padding:"8px 16px", cursor:"pointer" }}>
          <Power size={14} color={online ? "#fff" : "rgba(255,255,255,0.5)"} />
          <span style={{ color:online ? "#fff" : "rgba(255,255,255,0.5)", fontFamily:GR, fontWeight:700, fontSize:12.5 }}>
            {online ? "Online" : "Offline"}
          </span>
        </button>
      </div>

      {/* Driver stat strip */}
      <div style={{ background:C.navyLight, padding:"10px clamp(12px,4vw,24px)", display:"flex", gap:"clamp(16px,5vw,32px)", overflowX:"auto" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <Star size={13} color={C.yellow} fill={C.yellow} />
          <span style={{ color:"#fff", fontFamily:GR, fontSize:14, fontWeight:700 }}>{ME.rating}</span>
          <span style={{ color:"rgba(255,255,255,0.4)", fontFamily:IN, fontSize:11 }}>rating</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ color:"#fff", fontFamily:GR, fontSize:14, fontWeight:700 }}>{ME.tripsCompleted}</span>
          <span style={{ color:"rgba(255,255,255,0.4)", fontFamily:IN, fontSize:11 }}>trips completed</span>
        </div>
      </div>

      <div style={{ padding:"clamp(12px,3vw,20px)", maxWidth:520, margin:"0 auto" }}>

        {/* Offline state */}
        {!online && (
          <div style={{ background:C.white, borderRadius:14, padding:"36px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
            <Power size={28} color={C.muted} style={{ marginBottom:10 }} />
            <p style={{ color:C.muted, fontFamily:IN, fontSize:13.5, margin:0 }}>
              You're offline. Go online to start receiving ride requests.
            </p>
          </div>
        )}

        {/* Active trip */}
        {online && activeTrip && (
          <div style={{ background:C.navy, borderRadius:16, padding:20, marginBottom:16 }}>
            <div style={{ color:"rgba(247,195,68,0.7)", fontFamily:GR, fontSize:11, letterSpacing:1.5,
              textTransform:"uppercase", marginBottom:10 }}>Active Trip</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontFamily:IN, textTransform:"uppercase" }}>From</div>
                <div style={{ fontWeight:700, fontFamily:GR, fontSize:14, color:"#fff" }}>{getTerm(activeTrip.origin)?.name}</div>
              </div>
              <ArrowRight size={16} color="rgba(255,255,255,0.4)" />
              <div style={{ flex:1, textAlign:"right" }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontFamily:IN, textTransform:"uppercase" }}>To</div>
                <div style={{ fontWeight:700, fontFamily:GR, fontSize:14, color:C.yellow }}>{getTerm(activeTrip.destination)?.name}</div>
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#fff", fontFamily:GR, fontWeight:700, fontSize:17 }}>₱{activeTrip.fare}.00</span>
              <button onClick={handleComplete}
                style={{ background:C.yellow, color:C.navy, border:"none", borderRadius:10,
                  padding:"10px 18px", fontFamily:GR, fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Complete Trip
              </button>
            </div>
          </div>
        )}

        {/* Pending requests */}
        {online && !activeTrip && (
          <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <h3 style={{ color:C.text, fontFamily:GR, fontSize:14, fontWeight:700, margin:0 }}>
                Nearby Requests
                {available.length > 0 && (
                  <span style={{ marginLeft:6, background:C.danger, color:"#fff",
                    borderRadius:10, padding:"1px 7px", fontSize:11 }}>{available.length}</span>
                )}
              </h3>
              <span style={{ fontSize:11, color:C.muted, fontFamily:IN }}>Terminal: {getTerm(HOME_TERMINAL)?.short}</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {available.length === 0 && (
                <div style={{ background:C.white, borderRadius:14, padding:"32px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
                  <Truck size={22} color={C.muted} style={{ marginBottom:8 }} />
                  <p style={{ color:C.muted, fontFamily:IN, fontSize:13, margin:0 }}>No pending requests right now</p>
                </div>
              )}
              {available.map(req => <RequestCard key={req.id} req={req} onAccept={handleAccept} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
