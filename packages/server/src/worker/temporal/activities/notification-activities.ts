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
  userNotificationPreferences,
  projectNotificationOverrides
} from "../../../db/schema/notifications";
import {
  matchesNotificationChannelRouting,
  matchesNotificationSelector
} from "./notification-channel-routing";
import { deliverNotification } from "./notification-delivery";
import type { NotificationPayload } from "./notification-sender-types";

// Re-export builders so Temporal proxyActivities can find them
export {
  buildApprovalNotification,
  buildBackupNotification,
  buildDeployNotification,
  buildServerMetricNotification,
  buildTestNotification
} from "./notification-builders";

export type { NotificationPayload } from "./notification-sender-types";

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
      if (matchesNotificationSelector(eventType, override.eventType)) {
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
    if (matchesNotificationSelector(eventType, pref.eventType)) {
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
    .where(
      and(eq(notificationChannels.enabled, true), eq(notificationChannels.teamId, payload.teamId))
    );

  const results: Array<{
    channelId: string;
    channelName: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const channel of channels) {
    // 2. Check event selector match
    if (!matchesNotificationChannelRouting(channel, payload)) {
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

export async function dispatchNotificationToChannel(
  channelId: string,
  payload: NotificationPayload,
  options?: { ignoreRouting?: boolean; expectedTeamId?: string }
): Promise<{
  dispatched: number;
  succeeded: number;
  failed: number;
  results: Array<{ channelId: string; channelName: string; ok: boolean; error?: string }>;
}> {
  const expectedTeamId = options?.expectedTeamId ?? payload.teamId;
  if (expectedTeamId !== payload.teamId) {
    return {
      dispatched: 0,
      succeeded: 0,
      failed: 1,
      results: [
        {
          channelId,
          channelName: channelId,
          ok: false,
          error: "Channel team does not match notification team"
        }
      ]
    };
  }

  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(eq(notificationChannels.id, channelId), eq(notificationChannels.teamId, expectedTeamId))
    )
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
    if (!matchesNotificationChannelRouting(channel, payload)) {
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
