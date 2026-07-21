import { useState, useEffect } from "react";
import "./styles.css";
import { C, GR, Logo, SEED_LOGS } from "./shared.jsx";
import KioskView from "./KioskView.jsx";
import DriverView from "./DriverView.jsx";
import AdminView from "./AdminView.jsx";

const MODES = [
  { id:"kiosk",  label:"🛺 Kiosk"  },
  { id:"driver", label:"🚦 Driver" },
  { id:"admin",  label:"⚙️ Admin"  },
];

export default function App() {
  const [mode, setMode] = useState("kiosk");
  const [dispatchLog, setDispatchLog] = useState([...SEED_LOGS]);
  const [pendingRequests, setPendingRequests] = useState([]);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty("--vh", `${window.innerHeight * 0.01}px`);
    };
    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);
    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
    };
  }, []);

  return (
    <div className="app-shell" style={{ display:"flex", flexDirection:"column" }}>
      <div className="nav-ribbon" style={{ background:"#111", borderBottom:"1px solid #2a2a2a", flexShrink:0 }}>
        <div style={{ marginRight:14, opacity:0.9, flexShrink:0 }}><Logo size={20} /></div>
        {MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)}
            style={{ height:44, padding:"0 14px", border:"none", flexShrink:0,
              borderBottom:mode===m.id ? `2px solid ${C.yellow}` : "2px solid transparent",
              background:"transparent",
              color:mode===m.id ? C.yellow : "#666",
              fontFamily:GR, fontSize:12.5, fontWeight:mode===m.id?700:500,
              cursor:"pointer", whiteSpace:"nowrap" }}>
            {m.label}
          </button>
        ))}
        {pendingRequests.length > 0 && (
          <span style={{ marginLeft:6, background:C.danger, color:"#fff", borderRadius:10,
            padding:"1px 7px", fontSize:10.5, fontFamily:GR, fontWeight:700, flexShrink:0 }}>
            {pendingRequests.length} pending
          </span>
        )}
      </div>

      <div style={{ flex:1, minHeight:0, position:"relative" }}>
        {mode === "kiosk" && (
          <KioskView
            dispatchLog={dispatchLog}
            pendingRequests={pendingRequests}
            setPendingRequests={setPendingRequests}
          />
        )}
        {mode === "driver" && (
          <DriverView
            pendingRequests={pendingRequests}
            setPendingRequests={setPendingRequests}
            dispatchLog={dispatchLog}
            setDispatchLog={setDispatchLog}
          />
        )}
        {mode === "admin" && <AdminView dispatchLog={dispatchLog} />}
      </div>
    </div>
  );
}
