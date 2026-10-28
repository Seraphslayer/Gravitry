import { useState } from "react";
import { Delete, ChevronDown } from "lucide-react";
import { C, GR } from "./shared.jsx";

// Touch keyboard for the kiosk (a Raspberry Pi has no system keyboard).
// Controlled by the parent: it gets the current text and returns the new text.
const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

export default function OnScreenKeyboard({
  value,
  onChange,
  onDone,
  maxLength = 80,
}) {
  const [shift, setShift] = useState(true); // start of text = capital letter

  const press = (ch) => {
    if (value.length >= maxLength) return;
    const out = shift ? ch.toUpperCase() : ch;
    onChange(value + out);
    setShift(false);
  };
  const back = () => {
    const next = value.slice(0, -1);
    onChange(next);
    setShift(next === "" || next.endsWith(" "));
  };

  const key = {
    flex: "1 1 0",
    minWidth: 0,
    height: 52,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    background: C.white,
    color: C.text,
    fontFamily: GR,
    fontWeight: 700,
    fontSize: 18,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    touchAction: "manipulation",
    userSelect: "none",
    WebkitUserSelect: "none",
  };

  return (
    <div
      // keep focus on the search box and stop taps from selecting text
      onMouseDown={(e) => e.preventDefault()}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 12,
      }}
    >
      {ROWS.map((row, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: 6, padding: i === 2 ? "0 14px" : 0 }}
        >
          {i === 3 && (
            <button
              style={{
                ...key,
                flex: "1.5 1 0",
                background: shift ? C.navy : C.white,
                color: shift ? "#fff" : C.text,
              }}
              onClick={() => setShift((s) => !s)}
              aria-label="Shift"
            >
              ⇧
            </button>
          )}
          {row.map((k) => (
            <button key={k} style={key} onClick={() => press(k)}>
              {shift ? k.toUpperCase() : k}
            </button>
          ))}
          {i === 3 && (
            <button
              style={{ ...key, flex: "1.5 1 0" }}
              onClick={back}
              aria-label="Backspace"
            >
              <Delete size={20} />
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={{ ...key, flex: "1.2 1 0" }} onClick={() => press(",")}>
          ,
        </button>
        <button style={{ ...key, flex: "1.2 1 0" }} onClick={() => press(".")}>
          .
        </button>
        <button style={{ ...key, flex: "1.2 1 0" }} onClick={() => press("-")}>
          -
        </button>
        <button
          style={{ ...key, flex: "5 1 0", fontSize: 14 }}
          onClick={() => {
            onChange(value + " ");
            setShift(false);
          }}
        >
          space
        </button>
        <button
          style={{ ...key, flex: "1.6 1 0", fontSize: 13 }}
          onClick={() => {
            onChange("");
            setShift(true);
          }}
        >
          Clear
        </button>
        <button
          style={{
            ...key,
            flex: "2 1 0",
            background: C.navy,
            color: "#fff",
            border: "none",
            fontSize: 14,
            gap: 4,
          }}
          onClick={onDone}
        >
          <ChevronDown size={16} /> Done
        </button>
      </div>
    </div>
  );
}
