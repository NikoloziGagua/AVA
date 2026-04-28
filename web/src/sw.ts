/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

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
