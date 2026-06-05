/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Activate a new build immediately instead of waiting for every tab / PWA
// instance to close first. Without this, a freshly shipped bundle (e.g. a voice
// fix) installs but stays "waiting", so an already-open PWA keeps running the
// OLD code and a plain reload doesn't help — the owner has to fully close the
// app. Paired with the PWA's registerType:"autoUpdate", which reloads the page
// once the new SW takes control, so updates land on the next visit.
self.addEventListener("install", () => { void self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

precacheAndRoute(self.__WB_MANIFEST);

type PushData = {
  title?: string;
  body?: string;
  tag?: string;
  data?: { approvalId?: string; deepLink?: string };
};

self.addEventListener("push", (event) => {
  let data: PushData = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    /* ignore */
  }
  const isApproval = typeof data.tag === "string" && data.tag.startsWith("approval-");
  const opts: NotificationOptions = {
    body: data.body ?? "",
    icon: "/icon-192.png",
    tag: data.tag,
    data: data.data ?? {},
    requireInteraction: isApproval,
  };
  if (isApproval) {
    (opts as NotificationOptions & { actions?: { action: string; title: string }[] }).actions = [
      { action: "approve", title: "Approve" },
      { action: "deny", title: "Deny" },
    ];
  }
  event.waitUntil(self.registration.showNotification(data.title ?? "Ava", opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { deepLink?: string } | undefined;
  const target = data?.deepLink ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await (c as WindowClient).focus();
          if ("navigate" in c) {
            try { await (c as WindowClient).navigate(target); } catch { /* may be cross-origin */ }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
