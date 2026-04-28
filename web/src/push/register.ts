import { ApiError, fetchVapidPublicKey, registerPushSubscription } from "../api.js";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Std = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Std);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function enablePush(
  deviceLabel: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "push not supported in this browser" };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: `permission=${permission}` };

  const reg = await navigator.serviceWorker.ready;

  let key: string;
  try {
    key = await fetchVapidPublicKey();
  } catch (e) {
    const status = e instanceof ApiError ? e.status : "?";
    return { ok: false, reason: `vapid key fetch: ${status}` };
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  const subJson = sub.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    return { ok: false, reason: "subscription missing fields" };
  }

  try {
    await registerPushSubscription({
      endpoint: subJson.endpoint,
      keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      deviceLabel,
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : "?";
    return { ok: false, reason: `subscribe POST: ${status}` };
  }

  return { ok: true };
}
