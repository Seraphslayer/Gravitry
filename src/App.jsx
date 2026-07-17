import { useState, useEffect } from "react";
import "./styles.css";
import { C, GR, Logo } from "./shared.jsx";
import KioskView from "./KioskView.jsx";
import DispatcherView from "./DispatcherView.jsx";
import AdminView from "./AdminView.jsx";
import { SEED_LOGS } from "./shared.jsx";

const MODES = [
  { id:"kiosk",      label:"🛺 Kiosk"      },
  { id:"dispatcher", label:"📡 Dispatcher" },
  { id:"admin",      label:"⚙️ Admin"      },
];

export default function App() {
  const [mode, setMode] = useState("kiosk");
  const [dispatchLog, setDispatchLog] = useState([...SEED_LOGS]);

  // Fix for mobile browser viewport height (address bar collapsing/expanding)
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
      {/* Demo mode switcher — remove/hide in real kiosk deployment build */}
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
      </div>

      <div style={{ flex:1, minHeight:0, position:"relative" }}>
        {mode === "kiosk"      && <KioskView      dispatchLog={dispatchLog} setDispatchLog={setDispatchLog} />}
        {mode === "dispatcher" && <DispatcherView dispatchLog={dispatchLog} setDispatchLog={setDispatchLog} />}
        {mode === "admin"      && <AdminView      dispatchLog={dispatchLog} />}
      </div>
    </div>
  );
}
