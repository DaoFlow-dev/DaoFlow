/**
 * Channel-specific notification senders.
 *
 * Each sender formats the payload for its target platform (Slack, Discord,
 * generic webhook, email, Web Push) and returns a uniform result shape.
 *
 * Extracted from notification-activities.ts for AGENTS.md hygiene (≤500 LOC).
 */

import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "../../../db/connection";
import { pushSubscriptions } from "../../../db/schema/notifications";
import type { NotificationPayload } from "./notification-activities";

// ── Shared Constants ────────────────────────────────────────

export const SEVERITY_COLORS: Record<string, string> = {
  info: "#2196F3",
  success: "#4CAF50",
  warning: "#FF9800",
  error: "#F44336"
};

export const SEVERITY_EMOJI: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "🚨"
};

const DISCORD_COLORS: Record<string, number> = {
  info: 0x2196f3,
  success: 0x4caf50,
  warning: 0xff9800,
  error: 0xf44336
};

// ── Result Type ─────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  httpStatus: number;
  error?: string;
}

// ── Slack ────────────────────────────────────────────────────

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const color = SEVERITY_COLORS[payload.severity] ?? SEVERITY_COLORS.info;
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${payload.title}`, emoji: true }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: payload.message }
    }
  ];

  if (payload.fields && payload.fields.length > 0) {
    blocks.push({
      type: "section",
      fields: payload.fields.map((f) => ({
        type: "mrkdwn",
        text: `*${f.name}*\n${f.value}`
      }))
    });
  }

  const contextElements: object[] = [{ type: "mrkdwn", text: `*Event:* \`${payload.eventType}\`` }];
  if (payload.projectName) {
    contextElements.push({ type: "mrkdwn", text: `*Project:* ${payload.projectName}` });
  }
  if (payload.environmentName) {
    contextElements.push({ type: "mrkdwn", text: `*Env:* ${payload.environmentName}` });
  }
  contextElements.push({
    type: "mrkdwn",
    text: `*Time:* ${payload.timestamp ?? new Date().toISOString()}`
  });
  blocks.push({ type: "context", elements: contextElements });

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
      body: JSON.stringify({ attachments: [{ color, blocks }] }),
      signal: AbortSignal.timeout(10_000)
    });
    return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Discord ─────────────────────────────────────────────────

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const color = DISCORD_COLORS[payload.severity] ?? DISCORD_COLORS.info;
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";

  const embed: Record<string, unknown> = {
    title: `${emoji} ${payload.title}`,
    description: payload.message,
    color,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    footer: { text: `DaoFlow • ${payload.eventType}` }
  };

  if (payload.fields && payload.fields.length > 0) {
    embed.fields = payload.fields.map((f) => ({
      name: f.name,
      value: f.value,
      inline: f.inline ?? true
    }));
  } else {
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (payload.projectName)
      fields.push({ name: "Project", value: payload.projectName, inline: true });
    if (payload.environmentName)
      fields.push({ name: "Environment", value: payload.environmentName, inline: true });
    if (payload.serviceName)
      fields.push({ name: "Service", value: payload.serviceName, inline: true });
    if (fields.length > 0) embed.fields = fields;
  }

  if (payload.url) embed.url = payload.url;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "DaoFlow", embeds: [embed] }),
      signal: AbortSignal.timeout(10_000)
    });
    return {
      ok: res.ok || res.status === 204,
      httpStatus: res.status,
      error: res.ok || res.status === 204 ? undefined : await res.text()
    };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Generic Webhook ─────────────────────────────────────────

export async function sendGenericWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
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
      }),
      signal: AbortSignal.timeout(10_000)
    });
    return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Email ───────────────────────────────────────────────────

export async function sendEmailNotification(
  channel: { name: string; email: string | null },
  payload: NotificationPayload
): Promise<SendResult> {
  const to = channel.email;
  if (!to) {
    return { ok: false, httpStatus: 0, error: "No recipient email configured" };
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
    const { SMTP_ADDRESS, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAILER_FROM_ADDRESS } =
      process.env;
    const { RESEND_API_KEY, RESEND_FROM, RESEND_DOMAIN } = process.env;

    if (SMTP_ADDRESS && SMTP_PORT && SMTP_USERNAME && SMTP_PASSWORD && MAILER_FROM_ADDRESS) {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: SMTP_ADDRESS,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USERNAME,
          pass: SMTP_PASSWORD
        }
      });

      await transport.sendMail({
        from: MAILER_FROM_ADDRESS,
        to,
        subject,
        text: body
      });

      return { ok: true, httpStatus: 200 };
    }

    if (RESEND_API_KEY) {
      const from = RESEND_FROM ?? `DaoFlow <noreply@${RESEND_DOMAIN ?? "daoflow.app"}>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({ from, to: [to], subject, text: body })
      });
      return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
    }

    return {
      ok: false,
      httpStatus: 0,
      error: "No SMTP or Resend email transport is configured"
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return { ok: false, httpStatus: 0, error: message };
  }
}

// ── Web Push ────────────────────────────────────────────────

export async function sendWebPushNotifications(payload: NotificationPayload): Promise<SendResult> {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@daoflow.dev";

  if (!vapidPublicKey || !vapidPrivateKey) {
    return { ok: false, httpStatus: 0, error: "VAPID keys not configured — web push disabled" };
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const subscriptions = await db.select().from(pushSubscriptions);

  if (subscriptions.length === 0) {
    return { ok: true, httpStatus: 200, error: undefined };
  }

  let sent = 0;
  let failed = 0;

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

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload,
        { TTL: 86400 }
      );
      sent++;
      await db
        .update(pushSubscriptions)
        .set({ lastPushedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (err) {
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode: number }).statusCode
          : 0;
      if (statusCode === 410 || statusCode === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
      failed++;
    }
  }

  return {
    ok: sent > 0 || failed === 0,
    httpStatus: sent > 0 ? 200 : 0,
    error: failed > 0 ? `${failed} push delivery failures` : undefined
  };
}
