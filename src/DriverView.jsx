import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { ArrowRight, Clock, CheckCircle, Power, Star, Truck } from "lucide-react";
import { C, GR, IN, TERMINALS, COMPLEX_CENTER, INIT_DRIVERS, getTerm, TrikeIcon } from "./shared.jsx";

// Simulated logged-in driver — in a real deployment this would come from auth
const ME = INIT_DRIVERS[0]; // Rolando Dela Cruz, unit MCC-001, home terminal T1
const HOME_TERMINAL = "T1";

function makeDivIcon(color, pulse = false) {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
        ${pulse ? `<div class="gv-marker-pulse" style="width:34px;height:34px;top:0;left:0;"></div>` : ""}
        <div style="position:relative;width:26px;height:26px;border-radius:50% 50% 50% 0;background:${color};
          transform:rotate(-45deg);box-shadow:0 3px 8px rgba(0,0,0,0.35);border:2px solid #fff;">
        </div>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 30],
    popupAnchor: [0, -28],
  });
}
const terminalIcon = makeDivIcon(C.green, true);
const destIcon      = makeDivIcon(C.yellow, true);

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 17, { duration: 0.6 });
  }, [target, map]);
  return null;
}

function RequestCard({ req, onAccept }) {
  const wait = Math.round((Date.now() - new Date(req.ts).getTime()) / 60000);
  return (
    <div style={{ background:C.white, borderRadius:14, padding:16, border:`1px solid ${C.border}`,
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
  const [online, setOnline]         = useState(true);
  const [activeTrip, setActiveTrip] = useState(null);

  const available = pendingRequests.filter(r => r.origin === HOME_TERMINAL);
  const destTerm   = activeTrip ? getTerm(activeTrip.destination) : null;
  const flyTarget  = destTerm || getTerm(HOME_TERMINAL);

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
    <div className="kiosk-shell">
      {/* ── MAP ZONE ─────────────────────────────────────────────────────── */}
      <div className="kiosk-map-zone">
        <MapContainer center={COMPLEX_CENTER} zoom={16} zoomControl={false} attributionControl={false}
          style={{ width:"100%", height:"100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FlyTo target={flyTarget} />
          {TERMINALS.map(t => (
            <Marker key={t.id} position={[t.lat, t.lng]}
              icon={activeTrip && t.id === activeTrip.destination ? destIcon : terminalIcon}>
              <Popup>{t.name}</Popup>
            </Marker>
          ))}
        </MapContainer>

        <div style={{ position:"absolute", top:"calc(12px + var(--safe-top))", left:12,
          zIndex:400, display:"flex", alignItems:"center", gap:8,
          background:"rgba(11,45,72,0.92)", backdropFilter:"blur(6px)",
          padding:"8px 14px", borderRadius:30, boxShadow:"0 4px 16px rgba(0,0,0,0.25)" }}>
          <TrikeIcon size={18} color={C.yellow} />
          <span style={{ color:"#fff", fontFamily:GR, fontWeight:700, fontSize:13 }}>GRAVITRY</span>
        </div>

        <button onClick={() => setOnline(o => !o)}
          style={{ position:"absolute", top:"calc(12px + var(--safe-top))", right:12, zIndex:400,
            display:"flex", alignItems:"center", gap:7,
            background: online ? C.green : "rgba(255,255,255,0.95)",
            padding:"8px 14px", borderRadius:20, border:"none", cursor:"pointer",
            boxShadow:"0 4px 16px rgba(0,0,0,0.2)" }}>
          <Power size={14} color={online ? "#fff" : C.muted} />
          <span style={{ color:online ? "#fff" : C.muted, fontFamily:GR, fontWeight:700, fontSize:12 }}>
            {online ? "Online" : "Offline"}
          </span>
        </button>

        {activeTrip && (
          <div style={{ position:"absolute", bottom:12, left:12, right:12, zIndex:400,
            background:"rgba(11,45,72,0.95)", backdropFilter:"blur(6px)", borderRadius:14,
            padding:"10px 16px", display:"flex", alignItems:"center", gap:8,
            boxShadow:"0 4px 16px rgba(0,0,0,0.3)" }}>
            <Truck size={15} color={C.yellow} />
            <span style={{ color:"#fff", fontFamily:IN, fontSize:12.5 }}>
              Heading to <strong style={{ color:C.yellow }}>{destTerm?.name}</strong>
            </span>
          </div>
        )}
      </div>

      {/* ── BOTTOM SHEET ─────────────────────────────────────────────────── */}
      <div className="bottom-sheet">
        <div className="sheet-handle" />

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div>
            <div style={{ fontFamily:GR, fontWeight:700, fontSize:15, color:C.text }}>{ME.name}</div>
            <div style={{ fontFamily:IN, fontSize:12, color:C.muted }}>{ME.unit} · Terminal {getTerm(HOME_TERMINAL)?.short}</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <Star size={14} color={C.yellow} fill={C.yellow} />
            <span style={{ fontFamily:GR, fontWeight:700, fontSize:14, color:C.text }}>{ME.rating}</span>
            <span style={{ fontFamily:IN, fontSize:11, color:C.muted }}>({ME.tripsCompleted})</span>
          </div>
        </div>

        {!online && (
          <div style={{ background:C.surface, borderRadius:14, padding:"28px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
            <Power size={24} color={C.muted} style={{ marginBottom:8 }} />
            <p style={{ color:C.muted, fontFamily:IN, fontSize:13, margin:0 }}>
              You're offline. Tap the button on the map to start receiving requests.
            </p>
          </div>
        )}

        {online && activeTrip && (
          <div style={{ background:C.navy, borderRadius:16, padding:18 }}>
            <div style={{ color:"rgba(247,195,68,0.7)", fontFamily:GR, fontSize:10.5, letterSpacing:1.5,
              textTransform:"uppercase", marginBottom:10 }}>Active Trip · {activeTrip.id}</div>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontFamily:IN, textTransform:"uppercase" }}>From</div>
                <div style={{ fontWeight:700, fontFamily:GR, fontSize:13.5, color:"#fff" }}>{getTerm(activeTrip.origin)?.name}</div>
              </div>
              <ArrowRight size={15} color="rgba(255,255,255,0.4)" />
              <div style={{ flex:1, textAlign:"right" }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontFamily:IN, textTransform:"uppercase" }}>To</div>
                <div style={{ fontWeight:700, fontFamily:GR, fontSize:13.5, color:C.yellow }}>{getTerm(activeTrip.destination)?.name}</div>
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#fff", fontFamily:GR, fontWeight:700, fontSize:16 }}>₱{activeTrip.fare}.00</span>
              <button onClick={handleComplete}
                style={{ background:C.yellow, color:C.navy, border:"none", borderRadius:10,
                  padding:"10px 18px", fontFamily:GR, fontWeight:700, fontSize:13, cursor:"pointer" }}>
                Complete Trip
              </button>
            </div>
          </div>
        )}

        {online && !activeTrip && (
          <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <h3 style={{ color:C.text, fontFamily:GR, fontSize:13.5, fontWeight:700, margin:0 }}>
                Nearby Requests
                {available.length > 0 && (
                  <span style={{ marginLeft:6, background:C.danger, color:"#fff",
                    borderRadius:10, padding:"1px 7px", fontSize:11 }}>{available.length}</span>
                )}
              </h3>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {available.length === 0 && (
                <div style={{ background:C.surface, borderRadius:14, padding:"24px 20px", textAlign:"center", border:`1px solid ${C.border}` }}>
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
