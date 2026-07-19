import { db } from "../../../db/connection";
import { notificationChannels, notificationLogs } from "../../../db/schema/notifications";
import { newId } from "../../../db/services/json-helpers";
import {
  sendDiscordWebhook,
  sendEmailNotification,
  sendGenericWebhook,
  sendSlackWebhook,
  sendWebPushNotifications,
  type SendResult
} from "./notification-senders";
import {
  sendGotifyNotification,
  sendLarkWebhook,
  sendMattermostWebhook,
  sendNtfyNotification,
  sendPushoverNotification,
  sendTeamsWebhook,
  sendTelegramNotification
} from "./notification-extended-senders";
import type { NotificationPayload } from "./notification-sender-types";

export type NotificationChannelRecord = typeof notificationChannels.$inferSelect;
export type NotificationDeliveryResult = {
  channelId: string;
  channelName: string;
  ok: boolean;
  error?: string;
};

export async function deliverNotification(
  channel: NotificationChannelRecord,
  payload: NotificationPayload
): Promise<NotificationDeliveryResult> {
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
      case "telegram": {
        const meta = (channel.metadata ?? {}) as Record<string, string>;
        result = await sendTelegramNotification(meta.botToken ?? "", meta.chatId ?? "", payload);
        break;
      }
      case "teams":
        result = await sendTeamsWebhook(channel.webhookUrl!, payload);
        break;
      case "gotify": {
        const meta = (channel.metadata ?? {}) as Record<string, string>;
        result = await sendGotifyNotification(
          meta.serverUrl ?? channel.webhookUrl ?? "",
          meta.appToken ?? "",
          payload
        );
        break;
      }
      case "ntfy": {
        const meta = (channel.metadata ?? {}) as Record<string, string>;
        result = await sendNtfyNotification(
          meta.serverUrl ?? "https://ntfy.sh",
          meta.topic ?? "",
          payload
        );
        break;
      }
      case "mattermost":
        result = await sendMattermostWebhook(channel.webhookUrl!, payload);
        break;
      case "pushover": {
        const meta = (channel.metadata ?? {}) as Record<string, string>;
        result = await sendPushoverNotification(meta.userKey ?? "", meta.apiToken ?? "", payload);
        break;
      }
      case "lark":
        result = await sendLarkWebhook(channel.webhookUrl!, payload);
        break;
      default:
        result = await sendGenericWebhook(channel.webhookUrl ?? "", payload);
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
    // Don't fail the notification if logging fails.
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    ok: result.ok,
    error: result.error
  };
}
