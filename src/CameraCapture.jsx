import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Upload } from "lucide-react";
import { C, GR, IN } from "./shared.jsx";

// Longest edge of the saved photo, and JPEG quality. Keeps each photo around
// 100-250 KB so two of them fit comfortably in one signup request.
const MAX_EDGE = 1024;
const QUALITY = 0.72;

function drawToJpeg(source, srcW, srcH, stamp) {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  if (stamp) {
    // Date/time stamp so staff can see the selfie was taken just now.
    const text = new Date().toLocaleString("en-PH");
    const fontPx = Math.max(12, Math.round(h * 0.035));
    const pad = 6;
    ctx.font = `${fontPx}px sans-serif`;
    const textW = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, h - (fontPx + pad * 2), textW + pad * 2, fontPx + pad * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, pad, h - pad - 2);
  }
  return canvas.toDataURL("image/jpeg", QUALITY);
}

function fileToJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(drawToJpeg(img, img.naturalWidth, img.naturalHeight, false));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image"));
    };
    img.src = url;
  });
}

// facing: "user" (front camera, selfie) or "environment" (back camera, ID)
// value: the captured JPEG data URL (or null); onChange(dataUrl | null)
export default function CameraCapture({
  facing = "user",
  hint,
  stamp = false,
  value,
  onChange,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState(value ? "done" : "idle"); // idle | starting | live | blocked | done
  const [error, setError] = useState(null);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  // Always release the camera when leaving the step.
  useEffect(() => stopStream, []);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("blocked");
      setError(
        "The live camera is not available here. Use the button below instead.",
      );
      return;
    }
    setStatus("starting");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      setStatus("live");
    } catch {
      setStatus("blocked");
      setError(
        "Could not open the camera. Allow camera access, or use the button below.",
      );
    }
  };

  // Attach the stream once the <video> element exists.
  useEffect(() => {
    if (status === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [status]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const data = drawToJpeg(v, v.videoWidth, v.videoHeight, stamp);
    stopStream();
    onChange(data);
    setStatus("done");
  };

  const retake = () => {
    onChange(null);
    start();
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = await fileToJpeg(file);
      stopStream();
      onChange(data);
      setStatus("done");
      setError(null);
    } catch {
      setError("That file could not be used. Try taking the photo again.");
    }
  };

  const btn = (bg, fg) => ({
    flex: 1,
    padding: "13px 0",
    borderRadius: 12,
    border: "none",
    background: bg,
    color: fg,
    fontFamily: GR,
    fontWeight: 700,
    fontSize: 13.5,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  });

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          background: "#0B2D48",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {status === "live" && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: facing === "user" ? "scaleX(-1)" : "none",
            }}
          />
        )}
        {status === "done" && value && (
          <img
            src={value}
            alt="Captured"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        {(status === "idle" ||
          status === "starting" ||
          status === "blocked") && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <Camera size={30} color="rgba(255,255,255,0.5)" />
            <p
              style={{
                color: "rgba(255,255,255,0.7)",
                fontFamily: IN,
                fontSize: 12.5,
                margin: "8px 0 0",
              }}
            >
              {status === "starting" ? "Opening camera..." : hint}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "#FEF3C7",
            color: "#92400E",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: IN,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {(status === "idle" || status === "blocked") && (
          <button type="button" onClick={start} style={btn(C.navy, "#fff")}>
            <Camera size={16} color={C.yellow} /> Open camera
          </button>
        )}
        {status === "live" && (
          <button type="button" onClick={capture} style={btn(C.green, "#fff")}>
            <Camera size={16} /> Capture
          </button>
        )}
        {status === "done" && (
          <button type="button" onClick={retake} style={btn(C.surface, C.text)}>
            <RefreshCw size={15} /> Retake
          </button>
        )}
        {status !== "live" && status !== "done" && (
          <label
            style={{
              ...btn(C.surface, C.text),
              flex: "0 0 auto",
              padding: "13px 16px",
            }}
          >
            <Upload size={15} />
            <span>Use phone camera</span>
            <input
              type="file"
              accept="image/*"
              capture={facing === "user" ? "user" : "environment"}
              onChange={onFile}
              style={{ display: "none" }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
