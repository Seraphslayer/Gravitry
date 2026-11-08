import {
  getPushKey,
  savePushSubscription,
  removePushSubscription,
} from "./api.js";

// Browser side of push notifications (the server side is api/_push.js).

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// iPhones only allow notifications for apps added to the Home Screen.
export const needsHomeScreen = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !window.matchMedia("(display-mode: standalone)").matches &&
  !navigator.standalone;

const b64ToBytes = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function registration() {
  return (
    (await navigator.serviceWorker.getRegistration("/")) ||
    navigator.serviceWorker.register("/sw.js")
  );
}

// "on" | "off" | "blocked" | "unavailable" (not supported or not set up on the server)
export async function pushState() {
  if (!pushSupported()) return "unavailable";
  try {
    const key = await getPushKey();
    if (!key.enabled) return "unavailable";
  } catch {
    return "unavailable";
  }
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush() {
  const { enabled, publicKey } = await getPushKey();
  if (!enabled || !publicKey)
    throw new Error("Notifications are not set up yet");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notifications were not allowed");
  await registration();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(publicKey),
    }));
  await savePushSubscription(sub.toJSON());
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await removePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}
