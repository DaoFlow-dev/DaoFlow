/// <reference lib="webworker" />
/**
 * Task #59: Service worker with push/notificationclick handlers.
 * Handles incoming push notifications and click actions.
 */
declare const self: ServiceWorkerGlobalScope;

// ── Push Event Handler ──────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const raw: unknown = event.data.json();
    if (!raw || typeof raw !== "object" || !("title" in raw) || !("body" in raw)) {
      throw new Error("Invalid push payload");
    }
    const data = raw as {
      title: string;
      body: string;
      tag?: string;
      data?: { url?: string };
    };

    const options: NotificationOptions = {
      body: data.body,
      tag: data.tag ?? "daoflow",
      icon: "/icons/icon-192.svg",
      badge: "/icons/icon-192.svg",
      data: data.data
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch {
    // Fallback for non-JSON push
    const text = event.data.text();
    event.waitUntil(self.registration.showNotification("DaoFlow", { body: text }));
  }
});

// ── Notification Click Handler ──────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = (event.notification.data as { url?: string })?.url ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      // Focus existing DaoFlow tab if open (strict origin comparison)
      for (const client of clients) {
        try {
          const clientOrigin = new URL(client.url).origin;
          if (clientOrigin === self.location.origin) {
            await client.focus();
            await client.navigate(url);
            return;
          }
        } catch {
          // Invalid URL, skip this client
        }
      }
      // Otherwise open new tab
      await self.clients.openWindow(url);
    })
  );
});

// ── Activate: Claim clients immediately ─────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

export {};
