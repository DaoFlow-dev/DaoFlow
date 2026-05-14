import { SEVERITY_EMOJI, validateWebhookUrl } from "./notification-sender-shared";
import type { NotificationPayload, SendResult } from "./notification-sender-types";

function formatPlainText(payload: NotificationPayload): string {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const lines = [`${emoji} ${payload.title}`, payload.message];
  if (payload.projectName) lines.push(`Project: ${payload.projectName}`);
  if (payload.environmentName) lines.push(`Environment: ${payload.environmentName}`);
  if (payload.serviceName) lines.push(`Service: ${payload.serviceName}`);
  lines.push(`Event: ${payload.eventType}`);
  if (payload.url) lines.push(payload.url);
  return lines.join("\n");
}

async function postJson(
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<SendResult> {
  const urlCheck = validateWebhookUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, httpStatus: 0, error: `Webhook URL blocked: ${urlCheck.reason}` };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
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

export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const text = formatPlainText(payload);
  return postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

export async function sendTeamsWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const facts = [];
  if (payload.projectName) facts.push({ name: "Project", value: payload.projectName });
  if (payload.environmentName) facts.push({ name: "Environment", value: payload.environmentName });
  if (payload.serviceName) facts.push({ name: "Service", value: payload.serviceName });
  facts.push({ name: "Event", value: payload.eventType });

  return postJson(webhookUrl, {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: payload.severity === "error" ? "FF0000" : "0076D7",
    summary: `${emoji} ${payload.title}`,
    sections: [
      {
        activityTitle: `${emoji} ${payload.title}`,
        activitySubtitle: payload.message,
        facts,
        markdown: true
      }
    ],
    potentialAction: payload.url
      ? [
          {
            "@type": "OpenUri",
            name: "View Details",
            targets: [{ os: "default", uri: payload.url }]
          }
        ]
      : []
  });
}

export async function sendGotifyNotification(
  serverUrl: string,
  appToken: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const severity = payload.severity;
  const priority = severity === "error" ? 8 : severity === "warning" ? 5 : 2;
  return postJson(`${serverUrl.replace(/\/$/, "")}/message?token=${encodeURIComponent(appToken)}`, {
    title: payload.title,
    message: formatPlainText(payload),
    priority,
    extras: { "client::display": { contentType: "text/plain" } }
  });
}

export async function sendNtfyNotification(
  serverUrl: string,
  topic: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const sev = payload.severity;
  const priority = sev === "error" ? "4" : sev === "warning" ? "3" : "2";
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: payload.title,
        Priority: priority,
        Tags: `daoflow,${payload.eventType}`,
        ...(payload.url ? { Click: payload.url } : {})
      },
      body: formatPlainText(payload),
      signal: AbortSignal.timeout(10_000)
    });
    return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendMattermostWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const fields = [];
  if (payload.projectName) fields.push(`**Project:** ${payload.projectName}`);
  if (payload.environmentName) fields.push(`**Environment:** ${payload.environmentName}`);
  if (payload.serviceName) fields.push(`**Service:** ${payload.serviceName}`);
  fields.push(`**Event:** \`${payload.eventType}\``);

  return postJson(webhookUrl, {
    username: "DaoFlow",
    icon_url: "https://daoflow.dev/icon.png",
    text: `#### ${emoji} ${payload.title}\n${payload.message}\n\n${fields.join(" | ")}${payload.url ? `\n[View Details](${payload.url})` : ""}`
  });
}

export async function sendPushoverNotification(
  userKey: string,
  apiToken: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const priority = payload.severity === "error" ? 1 : 0;
  const body = new URLSearchParams({
    token: apiToken,
    user: userKey,
    title: payload.title,
    message: formatPlainText(payload),
    priority: String(priority),
    ...(payload.url ? { url: payload.url, url_title: "View Details" } : {})
  });

  try {
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000)
    });
    return { ok: res.ok, httpStatus: res.status, error: res.ok ? undefined : await res.text() };
  } catch (err) {
    return { ok: false, httpStatus: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendLarkWebhook(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<SendResult> {
  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  return postJson(webhookUrl, {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: `${emoji} ${payload.title}` },
        template:
          payload.severity === "error" ? "red" : payload.severity === "warning" ? "orange" : "blue"
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: payload.message } },
        {
          tag: "div",
          fields: [
            ...(payload.projectName
              ? [
                  {
                    is_short: true,
                    text: { tag: "lark_md", content: `**Project:** ${payload.projectName}` }
                  }
                ]
              : []),
            ...(payload.environmentName
              ? [
                  {
                    is_short: true,
                    text: { tag: "lark_md", content: `**Env:** ${payload.environmentName}` }
                  }
                ]
              : []),
            { is_short: true, text: { tag: "lark_md", content: `**Event:** ${payload.eventType}` } }
          ]
        },
        ...(payload.url
          ? [
              {
                tag: "action",
                actions: [
                  {
                    tag: "button",
                    text: { tag: "plain_text", content: "View Details" },
                    url: payload.url,
                    type: "primary"
                  }
                ]
              }
            ]
          : [])
      ]
    }
  });
}
