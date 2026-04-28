/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// Push handler is required for pushManager.subscribe to work in some browsers.
// M3 will deliver real pushes; for now, render whatever payload arrives.
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string } = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    /* ignore */
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Ava", {
      body: data.body ?? "",
      icon: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
