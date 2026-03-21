/**
 * Notification dispatch system for DaoFlow.
 *
 * Dispatches notifications to all matching channels based on event type,
 * project/environment filters, and user preference cascades.
 *
 * Channel-specific senders live in notification-senders.ts.
 * Payload builders live in notification-builders.ts.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../../../db/connection";
import {
  notificationChannels,
  notificationLogs,
  userNotificationPreferences,
  projectNotificationOverrides,
  type NotificationEventType
} from "../../../db/schema/notifications";
import { newId } from "../../../db/services/json-helpers";
import {
  sendSlackWebhook,
  sendDiscordWebhook,
  sendGenericWebhook,
  sendEmailNotification,
  sendWebPushNotifications,
  type SendResult
} from "./notification-senders";

// Re-export builders so Temporal proxyActivities can find them
export {
  buildApprovalNotification,
  buildBackupNotification,
  buildDeployNotification,
  buildTestNotification
} from "./notification-builders";

// ── Types ────────────────────────────────────────────────────

export interface NotificationPayload {
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  /** Optional structured fields for rich display */
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  /** Optional context (project, environment, service) for filtering */
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  /** Optional link to the resource */
  url?: string;
  /** Timestamp of the event */
  timestamp?: string;
}

type NotificationChannelRecord = typeof notificationChannels.$inferSelect;

// ── Event Selector Matching ─────────────────────────────────

/**
 * Check if an event type matches a selector pattern.
 * Supports:
 * - Exact match: "backup.failed" matches "backup.failed"
 * - Wildcard suffix: "backup.*" matches "backup.started", "backup.failed", etc.
 * - Global wildcard: "*" matches everything
 */
function matchesSelector(eventType: string, selector: string): boolean {
  if (selector === "*") return true;
  if (selector === eventType) return true;
  if (selector.endsWith(".*")) {
    const prefix = selector.slice(0, -2);
    return eventType.startsWith(prefix + ".");
  }
  return false;
}

/**
 * Check if an event type matches any selector in the array.
 */
function matchesAnySelector(eventType: string, selectors: unknown): boolean {
  if (!Array.isArray(selectors)) return false;
  return selectors.some((s) => typeof s === "string" && matchesSelector(eventType, s));
}

// ── Notification Preference Resolution ──────────────────────

/**
 * Resolve whether a notification should be sent for a user+event+channel combo.
 * Implements multi-level cascade:
 * 1. Check project-level overrides (most specific wins)
 * 2. Fall back to user-level preferences
 * 3. Fall back to default (enabled)
 */
export async function resolveNotificationPreference(
  userId: string,
  eventType: string,
  channelType: string,
  projectId?: string
): Promise<boolean> {
  // 1. Check project-level overrides first (most specific)
  if (projectId) {
    const projectOverrides = await db
      .select()
      .from(projectNotificationOverrides)
      .where(
        and(
          eq(projectNotificationOverrides.projectId, projectId),
          eq(projectNotificationOverrides.userId, userId)
        )
      );

    for (const override of projectOverrides) {
      if (matchesSelector(eventType, override.eventType)) {
        if (override.channelType === "*" || override.channelType === channelType) {
          return override.enabled;
        }
      }
    }
  }

  // 2. Check user-level preferences
  const userPrefs = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));

  for (const pref of userPrefs) {
    if (matchesSelector(eventType, pref.eventType)) {
      if (pref.channelType === "*" || pref.channelType === channelType) {
        return pref.enabled;
      }
    }
  }

  // 3. Default: enabled
  return true;
}

// ── Main Dispatch Activity ──────────────────────────────────

/**
 * Dispatch a notification to all matching channels.
 * This is the main Temporal activity for notifications.
 *
 * 1. Query all enabled notification channels
 * 2. Filter by event selector match
 * 3. Filter by project/environment if applicable
 * 4. Send to each matching channel
 * 5. Log delivery results
 */
export async function dispatchNotification(payload: NotificationPayload): Promise<{
  dispatched: number;
  succeeded: number;
  failed: number;
  results: Array<{ channelId: string; channelName: string; ok: boolean; error?: string }>;
}> {
  // 1. Get all enabled channels
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true));

  const results: Array<{
    channelId: string;
    channelName: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const channel of channels) {
    // 2. Check event selector match
    if (!matchesAnySelector(payload.eventType, channel.eventSelectors)) {
      continue;
    }

    // 3. Check project/environment filter
    if (channel.projectFilter && payload.projectName !== channel.projectFilter) {
      continue;
    }
    if (channel.environmentFilter && payload.environmentName !== channel.environmentFilter) {
      continue;
    }

    const result = await deliverNotification(channel, payload);
    results.push(result);
  }

  return {
    dispatched: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
}

async function deliverNotification(
  channel: NotificationChannelRecord,
  payload: NotificationPayload
): Promise<{ channelId: string; channelName: string; ok: boolean; error?: string }> {
  let result: SendResult;

  if (
    !channel.webhookUrl &&
    channel.channelType !== "email" &&
    channel.channelType !== "web_push"
  ) {
    result = { ok: false, httpStatus: 0, error: "No webhook URL configured" };
  } else {
    switch (channel.channelType) {
      case "slack":
        result = await sendSlackWebhook(channel.webhookUrl!, payload);
        break;
      case "discord":
        result = await sendDiscordWebhook(channel.webhookUrl!, payload);
        break;
      case "generic_webhook":
        result = await sendGenericWebhook(channel.webhookUrl!, payload);
        break;
      case "web_push":
        result = await sendWebPushNotifications(payload);
        break;
      case "email":
        result = await sendEmailNotification(channel, payload);
        break;
      default:
        result = {
          ok: false,
          httpStatus: 0,
          error: `Unknown channel type: ${channel.channelType}`
        };
    }
  }

  try {
    await db.insert(notificationLogs).values({
      id: newId(),
      channelId: channel.id,
      eventType: payload.eventType,
      payload: {
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        project: payload.projectName,
        environment: payload.environmentName
      },
      httpStatus: String(result.httpStatus),
      status: result.ok ? "delivered" : "failed",
      error: result.error ?? null,
      sentAt: new Date()
    });
  } catch {
    // Don't fail the notification if logging fails
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    ok: result.ok,
    error: result.error
  };
}

export async function dispatchNotificationToChannel(
  channelId: string,
  payload: NotificationPayload,
  options?: { ignoreRouting?: boolean }
): Promise<{
  dispatched: number;
  succeeded: number;
  failed: number;
  results: Array<{ channelId: string; channelName: string; ok: boolean; error?: string }>;
}> {
  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, channelId))
    .limit(1);

  if (!channel) {
    return {
      dispatched: 0,
      succeeded: 0,
      failed: 1,
      results: [{ channelId, channelName: channelId, ok: false, error: "Channel not found" }]
    };
  }

  if (!options?.ignoreRouting) {
    if (!channel.enabled) {
      return {
        dispatched: 0,
        succeeded: 0,
        failed: 1,
        results: [
          {
            channelId: channel.id,
            channelName: channel.name,
            ok: false,
            error: "Channel is disabled"
          }
        ]
      };
    }
    if (!matchesAnySelector(payload.eventType, channel.eventSelectors)) {
      return {
        dispatched: 0,
        succeeded: 0,
        failed: 1,
        results: [
          {
            channelId: channel.id,
            channelName: channel.name,
            ok: false,
            error: "Channel does not match this event selector"
          }
        ]
      };
    }
  }

  const result = await deliverNotification(channel, payload);
  return {
    dispatched: 1,
    succeeded: result.ok ? 1 : 0,
    failed: result.ok ? 0 : 1,
    results: [result]
  };
}
