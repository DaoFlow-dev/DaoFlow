/**
 * Task #69: React hook for Web Push subscription management.
 * Handles permission request, subscribe/unsubscribe, status check, server sync.
 */
import { useState, useCallback, useEffect } from "react";

export type PushStatus = "unsupported" | "denied" | "default" | "granted" | "subscribed";

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("unsupported");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }

    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("denied");
      return;
    }

    // Check existing subscription
    void navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        setSubscription(existing);
        setStatus("subscribed");
      } else {
        setStatus(permission === "granted" ? "granted" : "default");
      }
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const envVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      const vapidKey =
        typeof envVapidKey === "string" && envVapidKey.length > 0 ? envVapidKey : undefined;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey
      });

      setSubscription(sub);
      setStatus("subscribed");

      // Sync with server
      try {
        await fetch("/trpc/subscribePush", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() })
        });
      } catch {
        console.error("[push] Failed to sync subscription with server");
      }
    } catch (err) {
      console.error("[push] Subscribe failed:", err);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!subscription) return;

    try {
      await subscription.unsubscribe();

      // Notify server
      try {
        await fetch("/trpc/unsubscribePush", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
      } catch {
        console.error("[push] Failed to sync unsubscription with server");
      }

      setSubscription(null);
      setStatus("granted");
    } catch (err) {
      console.error("[push] Unsubscribe failed:", err);
    }
  }, [subscription]);

  return { status, subscription, subscribe, unsubscribe };
}
