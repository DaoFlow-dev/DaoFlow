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

    if (!channel.webhookUrl && channel.channelType !== "email") {
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
        case "email":
          // Email sending is a future feature, log as skipped
          result = { ok: false, httpStatus: 0, error: "Email sending not yet implemented" };
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
