import { DISCORD_COLORS, SEVERITY_COLORS, SEVERITY_EMOJI } from "./notification-sender-shared";
import type { NotificationPayload, SendResult } from "./notification-sender-types";

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
