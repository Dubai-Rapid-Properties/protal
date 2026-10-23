/*
 * D|R|P portal service worker: shows the portal's notifications and the
 * check-out / check-in alarms pushed while the portal is closed
 * (src/lib/push), as the phone's own notification banners. It does not cache
 * anything; pages always come from the network.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message;
  try {
    message = event.data.json();
  } catch {
    return;
  }
  // A dot on the app icon until the portal is opened again.
  if (!message.ack && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      // A repeat of the same ring replaces the last one and rings again.
      renotify: true,
      requireInteraction: Boolean(message.ack),
      vibrate: [400, 200, 400, 200, 400],
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: message.url, ack: message.ack },
      actions: message.ack ? [{ action: "done", title: "Done" }] : [],
    })
  );
});

async function openPage(url) {
  const target = new URL(url || "/", self.location.origin).href;
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of open) {
    if (client.url === target && "focus" in client) return client.focus();
  }
  return self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  const { url, ack } = event.notification.data || {};
  event.notification.close();
  if (event.action === "done" && ack) {
    event.waitUntil(
      fetch("/api/stay-alarms/ack", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ack),
      })
        .then((response) => {
          // Signed out on this phone: open the booking so it can be done there.
          if (!response.ok || response.redirected) return openPage(url);
        })
        .catch(() => openPage(url))
    );
    return;
  }
  event.waitUntil(openPage(url));
});
