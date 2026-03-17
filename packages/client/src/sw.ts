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
    const data = event.data.json() as {
      title: string;
      body: string;
      tag?: string;
      data?: {
        url?: string;
        eventType?: string;
        severity?: string;
        project?: string;
        environment?: string;
      };
    };

    const options: NotificationOptions = {
      body: data.body,
      tag: data.tag ?? "daoflow",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
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
      // Focus existing DaoFlow tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          await client.navigate(url);
          return;
        }
      }
      // Otherwise open new tab
      return self.clients.openWindow(url);
    })
  );
});

// ── Activate: Claim clients immediately ─────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

export {};
