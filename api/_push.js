import { createHash } from "node:crypto";
import webpush from "web-push";

// Free push notifications (Web Push) to phones and browsers that allowed them.
// Shared code, not a route. Everything here is best-effort: a failed or slow
// notification must NEVER break booking a ride, so nothing in this file throws.
//
// Needs these environment variables on Vercel (see README of this change):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// Without them push is simply switched off.
//
// In tests (PUSH_TEST=1) nothing is sent; messages are collected in
// global._gravitryPushLog so tests can check who would be notified.

let configured = null;
function configure() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@gravitry.local",
      pub,
      priv,
    );
    configured = true;
  } else configured = false;
  return configured;
}

export const pushEnabled = () => process.env.PUSH_TEST === "1" || configure();
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

// The server will POST to the address the browser gives us, so only the real
// push services are accepted (stops anyone using this to hit other servers).
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];
export function validSubscription(sub) {
  try {
    if (!sub || typeof sub !== "object") return false;
    const { endpoint, keys } = sub;
    if (typeof endpoint !== "string" || endpoint.length > 700) return false;
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return false;
    if (
      !PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))
    )
      return false;
    return (
      typeof keys?.p256dh === "string" &&
      typeof keys?.auth === "string" &&
      keys.p256dh.length < 200 &&
      keys.auth.length < 100
    );
  } catch {
    return false;
  }
}
export const subscriptionId = (endpoint) =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, 40);

// who: { role: "driver" | "passenger" | "admin" | "marshal" (or a list of them),
// id?: string, ids?: string[] } (no id = everyone with that role). payload: { title, body, url?, tag?, urgent? }
export async function notify(db, who, payload) {
  try {
    if (!pushEnabled()) return;
    const filter = {
      role: Array.isArray(who.role) ? { $in: who.role } : who.role,
    };
    if (who.ids) filter.userId = { $in: who.ids };
    else if (who.id) filter.userId = who.id;
    if (who.ids && !who.ids.length) return;
    const subs = await db
      .collection("push_subscriptions")
      .find(filter)
      .toArray();
    if (!subs.length) return;
    const body = JSON.stringify({
      title: String(payload.title || "Gravitry").slice(0, 80),
      body: String(payload.body || "").slice(0, 160),
      url: payload.url || "/",
      tag: payload.tag || undefined,
      urgent: !!payload.urgent,
    });
    if (process.env.PUSH_TEST === "1") {
      (global._gravitryPushLog ??= []).push({
        to: subs.map((s) => `${s.role}:${s.userId}`),
        ...JSON.parse(body),
      });
      return;
    }
    const send = Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(s.subscription, body, {
            TTL: 3600,
            urgency: payload.urgent ? "high" : "normal",
          });
        } catch (e) {
          // 404/410 = the person turned notifications off or reinstalled
          if (e?.statusCode === 404 || e?.statusCode === 410)
            await db.collection("push_subscriptions").deleteOne({ _id: s._id });
        }
      }),
    );
    // never hold up the response for more than a few seconds
    await Promise.race([send, new Promise((r) => setTimeout(r, 4000))]);
  } catch (e) {
    console.error("push failed:", e?.message || e);
  }
}

// ---- the messages the app sends (Taglish, short) ----------------------------
export const msg = {
  newRide: (r, kiosk) => ({
    title: "May pasahero!",
    body: kiosk
      ? "Pasahero sa kiosk. I-tap ang NFC card mo."
      : `Bagong booking mula sa app (${r.origin}).`,
    url: "/driver",
    tag: "new-ride",
    urgent: true,
  }),
  accepted: (r) => ({
    title: "Papunta na ang driver mo",
    body: `${r.driver || "Driver"}, ${r.unit || ""} ${r.plate ? `(${r.plate})` : ""}`.trim(),
    url: "/",
    tag: `ride-${r._id}`,
    urgent: true,
  }),
  arrived: (r) => ({
    title: "Dumating na ang driver",
    body: `${r.driver || "Driver"} ${r.unit ? `(${r.unit})` : ""} ay nasa pickup point.`,
    url: "/",
    tag: `ride-${r._id}`,
    urgent: true,
  }),
  finished: (r) => ({
    title: "Nakarating ka na",
    body: "Salamat sa pagsakay! I-rate ang driver mo.",
    url: "/",
    tag: `ride-${r._id}`,
  }),
  sos: (rep) => ({
    title: rep.kind === "sos" ? "SOS!" : "Bagong incident report",
    body: `${rep.reporter?.name || "Someone"} (${rep.reporter?.role || ""}) - ${rep.categoryLabel || ""}`,
    url: "/admin",
    tag: `report-${rep._id}`,
    urgent: rep.kind === "sos",
  }),
  reportResolved: (rep) => ({
    title: "Naresolba na ang report mo",
    body: rep.resolutionNote || "Tapos na ang report mo. Salamat!",
    url: "/",
    tag: `report-${rep._id}`,
  }),
  reportSeen: (rep) => ({
    title: "Natanggap ng TODA staff ang report mo",
    body: rep.acknowledgedNote || "Papunta na ang tulong",
    url: "/",
    tag: `report-${rep._id}`,
    urgent: true,
  }),
};

// A ride that is now on its way to the passenger: tell the passenger.
export const notifyAccepted = (db, ride) =>
  ride?.passengerId && ride.status === "dispatched"
    ? notify(
        db,
        { role: "passenger", id: ride.passengerId },
        msg.accepted(ride),
      )
    : Promise.resolve();
