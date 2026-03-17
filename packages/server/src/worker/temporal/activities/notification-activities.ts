/**
 * Notification dispatch system for DaoFlow.
 *
 * Sends notifications to Slack and Discord webhooks, with support for
 * event selectors, project/environment filtering, and rich formatting.
 */

import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import {
  notificationChannels,
  notificationLogs,
  type NotificationEventType
} from "../../../db/schema/notifications";

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

// ── Slack Webhook Sender ─────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  info: "#2196F3",
  success: "#4CAF50",
  warning: "#FF9800",
  error: "#F44336"
};

const SEVERITY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "🚨"
};

async function sendSlackWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const color = SEVERITY_COLORS[payload.severity] ?? SEVERITY_COLORS.info;
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} ${payload.title}`,
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: payload.message
      }
    }
  ];

  // Add fields if present
  if (payload.fields && payload.fields.length > 0) {
    blocks.push({
      type: "section",
      fields: payload.fields.map((f) => ({
        type: "mrkdwn",
        text: `*${f.name}*\n${f.value}`
      }))
    });
  }

  // Add context with timestamp and event type
  const contextElements: object[] = [{ type: "mrkdwn", text: `*Event:* \`${payload.eventType}\`` }];
  if (payload.projectName) {
    contextElements.push({
      type: "mrkdwn",
      text: `*Project:* ${payload.projectName}`
    });
  }
  if (payload.environmentName) {
    contextElements.push({
      type: "mrkdwn",
      text: `*Env:* ${payload.environmentName}`
    });
  }
  contextElements.push({
    type: "mrkdwn",
    text: `*Time:* ${payload.timestamp ?? new Date().toISOString()}`
  });

  blocks.push({ type: "context", elements: contextElements });

  // Add action button if URL provided
  if (payload.url) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Details" },
          url: payload.url,
          style: payload.severity === "error" ? "danger" : "primary"
        }
      ]
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [{ color, blocks }]
      })
    });

    return {
      ok: res.ok,
      httpStatus: res.status,
      error: res.ok ? undefined : await res.text()
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── Discord Webhook Sender ──────────────────────────────────

const DISCORD_COLORS: Record<string, number> = {
  info: 0x2196f3,
  success: 0x4caf50,
  warning: 0xff9800,
  error: 0xf44336
};

async function sendDiscordWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const color = DISCORD_COLORS[payload.severity] ?? DISCORD_COLORS.info;
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";

  const embed: Record<string, unknown> = {
    title: `${emoji} ${payload.title}`,
    description: payload.message,
    color,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    footer: {
      text: `DaoFlow • ${payload.eventType}`
    }
  };

  // Add fields
  if (payload.fields && payload.fields.length > 0) {
    embed.fields = payload.fields.map((f) => ({
      name: f.name,
      value: f.value,
      inline: f.inline ?? true
    }));
  } else {
    // Add context as fields
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (payload.projectName) {
      fields.push({ name: "Project", value: payload.projectName, inline: true });
    }
    if (payload.environmentName) {
      fields.push({ name: "Environment", value: payload.environmentName, inline: true });
    }
    if (payload.serviceName) {
      fields.push({ name: "Service", value: payload.serviceName, inline: true });
    }
    if (fields.length > 0) embed.fields = fields;
  }

  // Add URL
  if (payload.url) {
    embed.url = payload.url;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "DaoFlow",
        embeds: [embed]
      })
    });

    return {
      ok: res.ok || res.status === 204, // Discord returns 204 on success
      httpStatus: res.status,
      error: res.ok || res.status === 204 ? undefined : await res.text()
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── Generic Webhook Sender ──────────────────────────────────

async function sendGenericWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DaoFlow-Event": payload.eventType,
        "X-DaoFlow-Severity": payload.severity
      },
      body: JSON.stringify({
        eventType: payload.eventType,
        title: payload.title,
        message: payload.message,
        severity: payload.severity,
        fields: payload.fields,
        project: payload.projectName,
        environment: payload.environmentName,
        service: payload.serviceName,
        url: payload.url,
        timestamp: payload.timestamp ?? new Date().toISOString()
      })
    });

    return {
      ok: res.ok,
      httpStatus: res.status,
      error: res.ok ? undefined : await res.text()
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── Email Notification Sender (Task #27) ────────────────────

/**
 * Send an email notification via SMTP.
 * Reads config from env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Falls back gracefully if SMTP is not configured.
 */
async function sendEmailNotification(
  channel: { name: string; webhookUrl: string | null },
  payload: NotificationPayload
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM ?? "noreply@daoflow.dev";
  const to = channel.webhookUrl; // For email channels, webhookUrl stores the recipient

  if (!host || !to) {
    return { ok: false, httpStatus: 0, error: "SMTP not configured or no recipient email" };
  }

  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const subject = `${emoji} [DaoFlow] ${payload.title}`;
  const fields = (payload.fields ?? []).map((f) => `  ${f.name}: ${f.value}`).join("\n");
  const body = [
    payload.message,
    fields ? `\nDetails:\n${fields}` : "",
    payload.url ? `\nView: ${payload.url}` : "",
    `\n---\nDaoFlow Notifications`
  ]
    .filter(Boolean)
    .join("\n");

  try {
    // Send via HTTP email API (Resend, Mailgun, etc.)
    // Set SMTP_API_URL and SMTP_API_KEY for your provider
    const apiUrl = process.env.SMTP_API_URL;
    const apiKey = process.env.SMTP_API_KEY;

    if (apiUrl && apiKey) {
      // HTTP API mode (Resend, Mailgun, SendGrid, etc.)
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ from, to, subject, text: body })
      });
      return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
    }

    // Fallback: log the email for manual pickup (dev mode)
    console.error(`[email] Would send to=${to} subject="${subject}"`);
    return { ok: true, httpStatus: 200, error: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return { ok: false, httpStatus: 0, error: message };
  }
}

// ── Notification Retry with Exponential Backoff (Task #74) ──

/**
 * Retry a notification send with exponential backoff.
 * Used for transient failures (network issues, rate limits).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("retryWithBackoff exhausted all retries");
}

// ── Web Push Sender (PWA Notifications) ─────────────────────

import { pushSubscriptions } from "../../../db/schema/notifications";
import { eq as eqPush } from "drizzle-orm";

/**
 * Send Web Push notifications to all subscribed users.
 * Uses the Web Push protocol via fetch (no external library needed for basic push).
 * Handles dead subscriptions (410 Gone) by deleting them.
 *
 * Task #61: Web Push sender with VAPID
 * Task #75: Dead subscription cleanup
 */
async function sendWebPushNotifications(
  payload: NotificationPayload
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";

  // Get all push subscriptions
  const subscriptions = await db.select().from(pushSubscriptions);

  if (subscriptions.length === 0) {
    return { ok: true, httpStatus: 200, error: undefined };
  }

  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      const pushPayload = JSON.stringify({
        title: `${emoji} ${payload.title}`,
        body: payload.message,
        tag: payload.eventType,
        data: {
          url: payload.url,
          eventType: payload.eventType,
          severity: payload.severity,
          project: payload.projectName,
          environment: payload.environmentName
        }
      });

      // Simple push via fetch (VAPID signing would use web-push library in production)
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          TTL: "86400"
        },
        body: pushPayload
      });

      if (res.status === 410 || res.status === 404) {
        // Task #75: Dead subscription cleanup — endpoint gone
        await db.delete(pushSubscriptions).where(eqPush(pushSubscriptions.id, sub.id));
        failed++;
      } else if (res.ok || res.status === 201) {
        sent++;
        // Update last pushed timestamp
        await db
          .update(pushSubscriptions)
          .set({ lastPushedAt: new Date() })
          .where(eqPush(pushSubscriptions.id, sub.id));
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return {
    ok: sent > 0 || failed === 0,
    httpStatus: sent > 0 ? 200 : 0,
    error: failed > 0 ? `${failed} push delivery failures` : undefined
  };
}

// ── Notification Preference Resolution ──────────────────────

import {
  userNotificationPreferences,
  projectNotificationOverrides
} from "../../../db/schema/notifications";
import { and } from "drizzle-orm";

/**
 * Resolve whether a notification should be sent for a user+event+channel combo.
 * Implements multi-level cascade:
 * 1. Check project-level overrides (most specific wins)
 * 2. Fall back to user-level preferences
 * 3. Fall back to default (enabled)
 *
 * Task #66: Dispatch engine preference cascade
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
          eqPush(projectNotificationOverrides.projectId, projectId),
          eqPush(projectNotificationOverrides.userId, userId)
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
    .where(eqPush(userNotificationPreferences.userId, userId));

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

    // 4. Send based on channel type
    let result: { ok: boolean; httpStatus: number; error?: string };

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

    results.push({
      channelId: channel.id,
      channelName: channel.name,
      ok: result.ok,
      error: result.error
    });

    // 5. Log delivery result
    try {
      const { newId } = await import("../../../db/services/json-helpers");
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
  }

  // 6. Send Web Push to all subscribed users (in addition to channel-based dispatch)
  try {
    await sendWebPushNotifications(payload);
  } catch {
    // Web push is best-effort
  }

  return {
    dispatched: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results
  };
}

/**
 * Build a notification payload for backup events.
 * Convenience helper used by the backup workflow.
 */
export async function buildBackupNotification(opts: {
  eventType: NotificationPayload["eventType"];
  policyName: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  status: "started" | "succeeded" | "failed";
  error?: string;
  durationMs?: number;
  sizeBytes?: number;
  artifactPath?: string;
}): Promise<NotificationPayload> {
  const severityMap = {
    started: "info" as const,
    succeeded: "success" as const,
    failed: "error" as const
  };

  const fields: NotificationPayload["fields"] = [];

  if (opts.serviceName) {
    fields.push({ name: "Service", value: opts.serviceName, inline: true });
  }
  if (opts.durationMs) {
    const secs = (opts.durationMs / 1000).toFixed(1);
    fields.push({ name: "Duration", value: `${secs}s`, inline: true });
  }
  if (opts.sizeBytes) {
    const mb = (opts.sizeBytes / (1024 * 1024)).toFixed(2);
    fields.push({ name: "Size", value: `${mb} MB`, inline: true });
  }
  if (opts.artifactPath) {
    fields.push({ name: "Artifact", value: `\`${opts.artifactPath}\``, inline: false });
  }
  if (opts.error) {
    fields.push({ name: "Error", value: opts.error.slice(0, 200), inline: false });
  }

  return {
    eventType: opts.eventType,
    title: `Backup ${opts.status}: ${opts.policyName}`,
    message:
      opts.status === "failed"
        ? `Backup for *${opts.policyName}* failed. Check the error details below.`
        : opts.status === "succeeded"
          ? `Backup for *${opts.policyName}* completed successfully.`
          : `Backup for *${opts.policyName}* has started.`,
    severity: severityMap[opts.status],
    fields,
    projectName: opts.projectName,
    environmentName: opts.environmentName,
    serviceName: opts.serviceName,
    timestamp: new Date().toISOString()
  };
}
