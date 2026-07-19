import type { NotificationPayload } from "./notification-sender-types";

export type NotificationRoutingChannel = {
  eventSelectors: unknown;
  projectFilter?: string | null;
  environmentFilter?: string | null;
};

export function matchesNotificationSelector(eventType: string, selector: string): boolean {
  if (selector === "*") return true;
  if (selector === eventType) return true;
  if (selector.endsWith(".*")) {
    const prefix = selector.slice(0, -2);
    return eventType.startsWith(`${prefix}.`);
  }
  return false;
}

function matchesAnySelector(eventType: string, selectors: unknown): boolean {
  if (!Array.isArray(selectors)) return false;
  return selectors.some(
    (selector) => typeof selector === "string" && matchesNotificationSelector(eventType, selector)
  );
}

/**
 * Determines whether a channel's event and resource filters accept a payload.
 * Team ownership and enabled state are intentionally resolved by the caller.
 */
export function matchesNotificationChannelRouting(
  channel: NotificationRoutingChannel,
  payload: Pick<NotificationPayload, "eventType" | "projectName" | "environmentName">
): boolean {
  if (!matchesAnySelector(payload.eventType, channel.eventSelectors)) {
    return false;
  }
  if (channel.projectFilter && payload.projectName !== channel.projectFilter) {
    return false;
  }
  if (channel.environmentFilter && payload.environmentName !== channel.environmentFilter) {
    return false;
  }
  return true;
}
