import { useState, useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  ArrowRight,
  Clock,
  CheckCircle,
  Power,
  Star,
  Truck,
  LogOut,
  MapPin,
  Wifi,
  LocateFixed,
  Navigation,
  User,
} from "lucide-react";
import {
  C,
  GR,
  IN,
  TERMINALS,
  COMPLEX_CENTER,
  getTerm,
  TrikeIcon,
  useLiveLocation,
  myLocationIcon,
  pickupLabel,
  dropoffLabel,
  fmtKm,
  pinIcon,
  pickupPoint,
  dropoffPoint,
  distanceMeters,
  toLatLngs,
  etaMinutes,
  remainingAhead,
  useRoute,
  useLiveRoute,
  FitTo,
} from "./shared.jsx";
import {
  getDrivers,
  getRequests,
  acceptRequest,
  completeRequest,
  sendPresence,
  markPickedUp,
} from "./api.js";
import { useAuth } from "./AuthContext.jsx";

// Used as the driver's reference point when live GPS isn't available
// (permission denied, no signal, desktop browser, etc).
const HOME_TERMINAL = "T1"; // TODO: make this per-driver once terminals are assignable in the DB

function fmtDistance(m) {
  if (m == null || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m / 10) * 10 || 10} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

// Opens Google Maps turn-by-turn directions to a point (works on any phone).
const directionsUrl = (p) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

const terminalIcon = pinIcon(C.navy, false);
const pickupIcon = pinIcon(C.green, false);
const focusPickupIcon = pinIcon(C.green, true);
const dropoffIcon = pinIcon(C.yellow, true);

// "Center on me" button support.
function Recenter({ position, tick }) {
  const map = useMap();
  useEffect(() => {
    if (tick > 0 && position)
      map.flyTo([position.lat, position.lng], 17, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, map]);
  return null;
}

// Keeps the map centered on the driver as they move (until they drag the map).
function FollowDriver({ position, enabled, onUserDrag }) {
  const map = useMap();
  useMapEvents({
    dragstart() {
      onUserDrag();
    },
  });
  useEffect(() => {
    if (enabled && position)
      map.panTo([position.lat, position.lng], { animate: true, duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng, enabled, map]);
  return null;
}

function RequestCard({
  req,
  onAccept,
  onSelect,
  accepting,
  distance,
  isNearest,
  selected,
}) {
  const wait = Math.round((Date.now() - new Date(req.ts).getTime()) / 60000);
  const distLabel = fmtDistance(distance);
  const nfcOnly = req.source === "kiosk"; // kiosk rides are accepted by card tap only
  const pickup = pickupPoint(req);
  return (
    <div
      onClick={() => onSelect(req._id)}
      style={{
        background: C.white,
        borderRadius: 14,
        padding: 16,
        border: `${selected ? 2 : 1}px solid ${selected ? C.green : C.border}`,
        boxShadow: selected
          ? "0 2px 12px rgba(28,124,84,0.18)"
          : "0 1px 6px rgba(0,0,0,0.06)",
        cursor: "pointer",
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              background: C.surface,
              borderRadius: 5,
              padding: "2px 7px",
              color: C.muted,
            }}
          >
            {req._id}
          </span>
          {isNearest && (
            <span
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 9.5,
                color: C.greenDark,
                background: C.greenLight,
                borderRadius: 6,
                padding: "2px 6px",
                textTransform: "uppercase",
              }}
            >
              Nearest
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: C.muted,
            fontSize: 12,
            fontFamily: IN,
          }}
        >
          <Clock size={12} /> {wait <= 0 ? "Just now" : `${wait}m ago`}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              color: C.muted,
              fontFamily: IN,
              textTransform: "uppercase",
            }}
          >
            Passenger is at
          </div>
          <div
            style={{
              fontWeight: 700,
              fontFamily: GR,
              fontSize: 14,
              color: C.text,
            }}
          >
            {pickupLabel(req)}
          </div>
        </div>
        <ArrowRight size={16} color={C.muted} />
        <div style={{ flex: 1, textAlign: "right" }}>
          <div
            style={{
              fontSize: 10,
              color: C.muted,
              fontFamily: IN,
              textTransform: "uppercase",
            }}
          >
            Drop-off
          </div>
          <div
            style={{
              fontWeight: 700,
              fontFamily: GR,
              fontSize: 14,
              color: C.navy,
            }}
          >
            {dropoffLabel(req)}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          color: C.muted,
          fontFamily: IN,
          fontSize: 12,
          marginBottom: 12,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <MapPin size={12} color={C.green} />
          {distLabel ? `Pickup is ${distLabel}` : "Pickup location"}
          {req.distanceMeters ? ` · trip ${fmtKm(req.distanceMeters)}` : ""}
        </span>
        {pickup && (
          <a
            href={directionsUrl(pickup)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: C.green,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            <Navigation size={12} /> Directions
          </a>
        )}
      </div>
      {req.passengerName && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: C.muted,
            fontFamily: IN,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          <User size={12} /> Passenger: {req.passengerName}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontFamily: GR,
            fontSize: 18,
            color: C.green,
          }}
        >
          ₱{req.fare}.00
        </span>
        {nfcOnly ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: C.surface,
              color: C.muted,
              borderRadius: 10,
              padding: "9px 14px",
              fontFamily: GR,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Wifi size={14} /> Tap card at kiosk
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAccept(req);
            }}
            disabled={accepting}
            style={{
              background: accepting ? C.muted : C.green,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontFamily: GR,
              fontSize: 13.5,
              fontWeight: 700,
              cursor: accepting ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 3px 12px rgba(28,124,84,0.3)",
            }}
          >
            <CheckCircle size={15} /> {accepting ? "Accepting…" : "Accept"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function DriverView() {
  const { user, logout } = useAuth();
  const [me, setMe] = useState(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState([]);
  const [activeTrip, setActiveTrip] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [recenterTick, setRecenterTick] = useState(0);
  const [follow, setFollow] = useState(false); // map follows the driver
  const [arrivedTripId, setArrivedTripId] = useState(null); // passenger picked up
  const [trail, setTrail] = useState([]); // where the driver has driven this trip
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  // Persistent "you are here" GPS dot - the driver always sees their own live
  // position on the map, together with the passenger's pickup point.
  const { position: myPosition, error: locationError } = useLiveLocation();

  useEffect(() => {
    getDrivers()
      .then((list) => setMe(list.find((d) => d._id === user.driverId) || null))
      .catch(() => setError("Could not load driver profile."));
  }, [user.driverId]);

  useEffect(() => {
    if (!online) return;
    const tick = async () => {
      try {
        // Drivers see pending rides from every terminal, not just their own.
        // Sorting by distance happens below so the nearest ones come first.
        const [pendingReqs, dispatchedReqs] = await Promise.all([
          getRequests({ status: "pending" }),
          getRequests({ status: "dispatched" }),
        ]);
        setPending(pendingReqs);
        const mine = dispatchedReqs.find((r) => r.driverId === user.driverId);
        setActiveTrip(mine || null);
        setError(null);
      } catch {
        setError("Connection lost. Retrying…");
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [online, user.driverId]);

  // Presence heartbeat: lets the admin see this driver as Active (Online) or
  // Off duty. Sent right away whenever the Online / Offline switch changes,
  // then every 15 seconds while Online. If the app stops reporting (phone off,
  // no signal, tab closed) the server drops the driver to Off duty by itself.
  // The driver's GPS position rides along with it, so the passenger being
  // picked up can watch them arrive. While a trip is active it is sent every
  // 4 seconds; otherwise every 15.
  const posRef = useRef(null);
  posRef.current = myPosition
    ? { lat: myPosition.lat, lng: myPosition.lng }
    : null;
  const onTrip = !!activeTrip;
  useEffect(() => {
    sendPresence(online, posRef.current).catch(() => {});
    if (!online) return;
    const id = setInterval(
      () => sendPresence(true, posRef.current).catch(() => {}),
      onTrip ? 4000 : 15000,
    );
    return () => clearInterval(id);
  }, [online, onTrip]);

  // Closing or leaving the page counts as going offline right away.
  useEffect(() => {
    const onLeave = () => {
      try {
        navigator.sendBeacon(
          "/api/drivers?action=presence",
          new Blob([JSON.stringify({ online: false })], {
            type: "application/json",
          }),
        );
      } catch {
        /* the server timeout will cover it */
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, []);

  // Reference point for "near me": live GPS if we have it, otherwise the
  // driver's home terminal.
  const refPoint = useMemo(() => {
    if (myPosition) return { lat: myPosition.lat, lng: myPosition.lng };
    const t = getTerm(HOME_TERMINAL);
    return t ? { lat: t.lat, lng: t.lng } : null;
  }, [myPosition]);

  // Pending rides with their pickup distance, nearest first. Ties (and rides
  // whose pickup is unknown) fall back to oldest first.
  const sortedPending = useMemo(() => {
    const withDist = pending.map((r) => {
      // exact pickup point if the ride has one, else its terminal
      const t = pickupPoint(r);
      const dist =
        refPoint && t
          ? distanceMeters(refPoint.lat, refPoint.lng, t.lat, t.lng)
          : Infinity;
      return { req: r, dist };
    });
    withDist.sort(
      (a, b) => a.dist - b.dist || new Date(a.req.ts) - new Date(b.req.ts),
    );
    return withDist;
  }, [pending, refPoint]);

  // The ride shown on the map: the active trip if there is one, otherwise the
  // ride the driver tapped, otherwise the nearest one.
  const focusReq = useMemo(() => {
    if (activeTrip) return activeTrip;
    const picked = sortedPending.find((x) => x.req._id === selectedId);
    return (picked || sortedPending[0])?.req || null;
  }, [activeTrip, sortedPending, selectedId]);

  const focusPickup = focusReq ? pickupPoint(focusReq) : null;
  const focusDropoff = focusReq ? dropoffPoint(focusReq) : null;
  const driverPoint = myPosition
    ? { lat: myPosition.lat, lng: myPosition.lng }
    : null;

  // Phase A: heading to the passenger. Phase B: passenger picked up, heading
  // to the drop-off. Picked up = the driver reached the pickup point (within
  // 50 m of it) or tapped "Passenger picked up".
  // (pickedUpAt survives a page reload; arrivedTripId is the local flag.)
  const phaseB =
    !!activeTrip &&
    (arrivedTripId === activeTrip._id || !!activeTrip.pickedUpAt);
  const legTarget = phaseB ? focusDropoff : focusPickup;

  // The line from the driver to wherever they are heading now. It follows the
  // driver and shrinks as they get closer.
  const liveRoute = useLiveRoute(driverPoint, legTarget);
  const ahead =
    liveRoute && driverPoint
      ? remainingAhead(liveRoute.coords, driverPoint)
      : null;

  // Preview of the whole trip (pickup -> drop-off) while still heading to the
  // passenger.
  const tripPreview = useRoute(focusPickup, focusDropoff);

  // Auto-detect pickup: close enough to the passenger's pickup point.
  useEffect(() => {
    if (!activeTrip || phaseB || !driverPoint || !focusPickup) return;
    const d = distanceMeters(
      driverPoint.lat,
      driverPoint.lng,
      focusPickup.lat,
      focusPickup.lng,
    );
    if (d <= 50) setArrivedTripId(activeTrip._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?._id, phaseB, driverPoint?.lat, driverPoint?.lng]);

  // Tell the server (and so the passenger's screen) the moment the passenger
  // has been picked up.
  useEffect(() => {
    if (phaseB && activeTrip) markPickedUp(activeTrip._id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseB, activeTrip?._id]);

  // Trail of where the driver has actually driven since the pickup.
  useEffect(() => {
    if (!phaseB) {
      setTrail([]);
      return;
    }
    if (!driverPoint) return;
    setTrail((t) => {
      const lastPt = t[t.length - 1];
      if (
        lastPt &&
        distanceMeters(lastPt[0], lastPt[1], driverPoint.lat, driverPoint.lng) <
          10
      )
        return t;
      return [...t.slice(-300), [driverPoint.lat, driverPoint.lng]];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseB, driverPoint?.lat, driverPoint?.lng]);

  // The map follows the driver during a trip.
  useEffect(() => {
    setFollow(!!activeTrip);
  }, [activeTrip?._id]);

  // Text for the live chip on the map.
  const nearDropoff = phaseB && ahead && ahead.meters < 40;
  const chip = (() => {
    if (!focusReq || !ahead) return null;
    if (nearDropoff) return { text: "You've arrived at the drop-off" };
    const who = phaseB ? "to drop-off" : "to passenger";
    return {
      text: `${fmtKm(ahead.meters)} ${who} · ~${etaMinutes(ahead.meters)} min`,
    };
  })();

  const handleAccept = async (req) => {
    setAccepting(true);
    try {
      const doc = await acceptRequest(req._id, user.driverId);
      setActiveTrip(doc);
      setPending((p) => p.filter((r) => r._id !== req._id));
    } catch (err) {
      const msg = err.message
        ? err.message.replace(/^API .* failed: /, "")
        : "";
      setError(
        /NFC/i.test(msg)
          ? msg
          : "That request was just taken by another driver.",
      );
    }
    setAccepting(false);
  };

  const handleComplete = async () => {
    try {
      await completeRequest(activeTrip._id);
      setActiveTrip(null);
    } catch {
      setError("Could not complete trip. Try again.");
    }
  };

  const handleLogout = async () => {
    try {
      await sendPresence(false);
    } catch {
      /* log out anyway */
    }
    logout();
  };

  const fitKey = `${focusReq?._id || "none"}|${!!myPosition}|${phaseB}`;
  const activePickup = activeTrip ? pickupPoint(activeTrip) : null;
  const activeDropoff = activeTrip ? dropoffPoint(activeTrip) : null;

  return (
    <div className="kiosk-shell">
      <div className="kiosk-map-zone">
        <MapContainer
          center={COMPLEX_CENTER}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitTo
            points={[driverPoint, focusPickup, focusDropoff]}
            fitKey={fitKey}
          />
          <Recenter position={myPosition} tick={recenterTick} />
          <FollowDriver
            position={myPosition}
            enabled={follow}
            onUserDrag={() => setFollow(false)}
          />

          {TERMINALS.map((t) => (
            <Marker key={t.id} position={[t.lat, t.lng]} icon={terminalIcon}>
              <Popup>{t.name}</Popup>
            </Marker>
          ))}

          {/* whole trip preview while still heading to the passenger */}
          {!phaseB && tripPreview && (
            <Polyline
              positions={toLatLngs(tripPreview.coords)}
              pathOptions={{
                color: C.green,
                weight: 4,
                opacity: 0.45,
                dashArray: "8 8",
              }}
            />
          )}
          {/* where the driver has driven since picking up the passenger */}
          {phaseB && trail.length > 1 && (
            <Polyline
              positions={trail}
              pathOptions={{ color: "#9CA3AF", weight: 5, opacity: 0.9 }}
            />
          )}
          {/* live line from the driver to where they are heading now: it
              starts at the driver dot and shrinks as they get closer */}
          {ahead && (
            <Polyline
              positions={ahead.line}
              pathOptions={{
                color: phaseB ? C.green : C.navy,
                weight: 6,
                opacity: 0.9,
              }}
            />
          )}

          {/* where each waiting passenger is */}
          {!activeTrip &&
            online &&
            sortedPending.map(({ req }) => {
              const p = pickupPoint(req);
              if (!p || req._id === focusReq?._id) return null;
              return (
                <Marker
                  key={req._id}
                  position={[p.lat, p.lng]}
                  icon={pickupIcon}
                  eventHandlers={{ click: () => setSelectedId(req._id) }}
                >
                  <Popup>
                    Passenger: {pickupLabel(req)} · ₱{req.fare}.00
                  </Popup>
                </Marker>
              );
            })}

          {/* the focused passenger's pickup point and drop-off point */}
          {focusPickup && (
            <Marker
              position={[focusPickup.lat, focusPickup.lng]}
              icon={focusPickupIcon}
            >
              <Popup>
                Passenger is here: {pickupLabel(focusReq)}
                {focusReq?.passengerName ? ` (${focusReq.passengerName})` : ""}
              </Popup>
            </Marker>
          )}
          {focusDropoff && (
            <Marker
              position={[focusDropoff.lat, focusDropoff.lng]}
              icon={dropoffIcon}
            >
              <Popup>Drop-off: {dropoffLabel(focusReq)}</Popup>
            </Marker>
          )}

          {/* you */}
          {myPosition && (
            <Marker
              position={[myPosition.lat, myPosition.lng]}
              icon={myLocationIcon}
              zIndexOffset={1000}
            >
              <Popup>You are here</Popup>
            </Marker>
          )}
        </MapContainer>

        <div
          style={{
            position: "absolute",
            top: "calc(12px + var(--safe-top))",
            left: 12,
            zIndex: 400,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(11,45,72,0.92)",
            backdropFilter: "blur(6px)",
            padding: "8px 14px",
            borderRadius: 30,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          }}
        >
          <TrikeIcon size={18} color={C.yellow} />
          <span
            style={{
              color: "#fff",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            GRAVITRY
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            top: "calc(12px + var(--safe-top))",
            right: 12,
            zIndex: 400,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={() => setOnline((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: online ? C.green : "rgba(255,255,255,0.95)",
              padding: "8px 14px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            }}
          >
            <Power size={14} color={online ? "#fff" : C.muted} />
            <span
              style={{
                color: online ? "#fff" : C.muted,
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {online ? "Online" : "Offline"}
            </span>
          </button>
          <button
            onClick={handleLogout}
            title="Log out"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.95)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            }}
          >
            <LogOut size={14} color={C.muted} />
          </button>
        </div>

        {chip && (
          <div
            style={{
              position: "absolute",
              top: "calc(60px + var(--safe-top))",
              left: 12,
              zIndex: 400,
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: nearDropoff ? C.green : "rgba(255,255,255,0.96)",
              color: nearDropoff ? "#fff" : C.text,
              padding: "8px 14px",
              borderRadius: 20,
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              fontFamily: GR,
              fontWeight: 700,
              fontSize: 12.5,
            }}
          >
            <Navigation size={14} color={nearDropoff ? "#fff" : C.green} />
            {chip.text}
          </div>
        )}

        <button
          onClick={() => {
            setFollow(true);
            setRecenterTick((n) => n + 1);
          }}
          disabled={!myPosition}
          title="Center the map on my location"
          style={{
            position: "absolute",
            top: "calc(60px + var(--safe-top))",
            right: 12,
            zIndex: 400,
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: follow ? C.navy : "rgba(255,255,255,0.95)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            cursor: myPosition ? "pointer" : "default",
            opacity: myPosition ? 1 : 0.5,
          }}
        >
          <LocateFixed size={17} color={follow ? C.yellow : C.navy} />
        </button>

        {activeTrip && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              right: 12,
              zIndex: 400,
              background: "rgba(11,45,72,0.95)",
              backdropFilter: "blur(6px)",
              borderRadius: 14,
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}
          >
            <Truck size={15} color={C.yellow} />
            <span style={{ color: "#fff", fontFamily: IN, fontSize: 12.5 }}>
              Heading to{" "}
              <strong style={{ color: C.yellow }}>
                {dropoffLabel(activeTrip)}
              </strong>
            </span>
          </div>
        )}
      </div>

      <div className="bottom-sheet">
        <div className="sheet-handle" />

        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: IN,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {!myPosition && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "#FEF3C7",
              color: "#92400E",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              fontFamily: IN,
              marginBottom: 12,
              lineHeight: 1.45,
            }}
          >
            <LocateFixed size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {locationError
                ? "Location is off, so your position isn't shown. Allow location access in your browser to see where you are."
                : "Finding your location…"}
            </span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: GR,
                fontWeight: 700,
                fontSize: 15,
                color: C.text,
              }}
            >
              {me?.name || "Loading…"}
            </div>
            <div style={{ fontFamily: IN, fontSize: 12, color: C.muted }}>
              {me?.unit} · Terminal {getTerm(HOME_TERMINAL)?.short}
            </div>
          </div>
          {me && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Star size={14} color={C.yellow} fill={C.yellow} />
              <span
                style={{
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 14,
                  color: C.text,
                }}
              >
                {me.rating}
              </span>
              <span style={{ fontFamily: IN, fontSize: 11, color: C.muted }}>
                ({me.tripsCompleted})
              </span>
            </div>
          )}
        </div>

        {!online && (
          <div
            style={{
              background: C.surface,
              borderRadius: 14,
              padding: "28px 20px",
              textAlign: "center",
              border: `1px solid ${C.border}`,
            }}
          >
            <Power size={24} color={C.muted} style={{ marginBottom: 8 }} />
            <p
              style={{
                color: C.muted,
                fontFamily: IN,
                fontSize: 13,
                margin: 0,
              }}
            >
              You're offline. Tap the button on the map to start receiving
              requests.
            </p>
          </div>
        )}

        {online && activeTrip && (
          <div style={{ background: C.navy, borderRadius: 16, padding: 18 }}>
            <div
              style={{
                color: "rgba(247,195,68,0.7)",
                fontFamily: GR,
                fontSize: 10.5,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Active Trip · {activeTrip._id}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: IN,
                    textTransform: "uppercase",
                  }}
                >
                  Passenger is at
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontFamily: GR,
                    fontSize: 13.5,
                    color: "#fff",
                  }}
                >
                  {pickupLabel(activeTrip)}
                </div>
              </div>
              <ArrowRight size={15} color="rgba(255,255,255,0.4)" />
              <div style={{ flex: 1, textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: IN,
                    textTransform: "uppercase",
                  }}
                >
                  To
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontFamily: GR,
                    fontSize: 13.5,
                    color: C.yellow,
                  }}
                >
                  {dropoffLabel(activeTrip)}
                </div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                marginBottom: 14,
                fontFamily: IN,
                fontSize: 12,
              }}
            >
              {activePickup && (
                <a
                  href={directionsUrl(activePickup)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    color: C.yellow,
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  <Navigation size={12} /> Directions to passenger
                </a>
              )}
              {activeDropoff && (
                <a
                  href={directionsUrl(activeDropoff)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    color: C.yellow,
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  <Navigation size={12} /> Directions to drop-off
                </a>
              )}
            </div>
            {!phaseB && (
              <button
                onClick={() => setArrivedTripId(activeTrip._id)}
                style={{
                  width: "100%",
                  marginBottom: 14,
                  background: "transparent",
                  color: C.yellow,
                  border: `1.5px solid ${C.yellow}`,
                  borderRadius: 10,
                  padding: "10px 0",
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                Passenger picked up
              </button>
            )}
            {(activeTrip.passengerName || activeTrip.distanceMeters) && (
              <div
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontFamily: IN,
                  fontSize: 12,
                  marginBottom: 14,
                }}
              >
                {activeTrip.passengerName
                  ? `Passenger: ${activeTrip.passengerName}`
                  : ""}
                {activeTrip.passengerName && activeTrip.distanceMeters
                  ? " · "
                  : ""}
                {activeTrip.distanceMeters
                  ? `Trip ${fmtKm(activeTrip.distanceMeters)}`
                  : ""}
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: "#fff",
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                ₱{activeTrip.fare}.00
              </span>
              <button
                onClick={handleComplete}
                style={{
                  background: C.yellow,
                  color: C.navy,
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 18px",
                  fontFamily: GR,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Complete Trip
              </button>
            </div>
          </div>
        )}

        {online && !activeTrip && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <h3
                style={{
                  color: C.text,
                  fontFamily: GR,
                  fontSize: 13.5,
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                Ride Requests
                {sortedPending.length > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      background: C.danger,
                      color: "#fff",
                      borderRadius: 10,
                      padding: "1px 7px",
                      fontSize: 11,
                    }}
                  >
                    {sortedPending.length}
                  </span>
                )}
              </h3>
              <span style={{ fontSize: 10.5, color: C.muted, fontFamily: IN }}>
                Tap a ride to see it on the map
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sortedPending.length === 0 && (
                <div
                  style={{
                    background: C.surface,
                    borderRadius: 14,
                    padding: "24px 20px",
                    textAlign: "center",
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <p
                    style={{
                      color: C.muted,
                      fontFamily: IN,
                      fontSize: 13,
                      margin: 0,
                    }}
                  >
                    No pending requests right now
                  </p>
                </div>
              )}
              {sortedPending.map(({ req, dist }, i) => (
                <RequestCard
                  key={req._id}
                  req={req}
                  onAccept={handleAccept}
                  onSelect={setSelectedId}
                  accepting={accepting}
                  distance={dist}
                  isNearest={i === 0 && sortedPending.length > 1}
                  selected={focusReq?._id === req._id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
