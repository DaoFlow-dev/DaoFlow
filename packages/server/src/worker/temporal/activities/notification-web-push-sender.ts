import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "../../../db/connection";
import { pushSubscriptions } from "../../../db/schema/notifications";
import { teamMembers } from "../../../db/schema/teams";
import { SEVERITY_EMOJI } from "./notification-sender-shared";
import type { NotificationPayload, SendResult } from "./notification-sender-types";

export async function sendWebPushNotifications(payload: NotificationPayload): Promise<SendResult> {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@daoflow.dev";

  if (!vapidPublicKey || !vapidPrivateKey) {
    return { ok: false, httpStatus: 0, error: "VAPID keys not configured — web push disabled" };
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const emoji = SEVERITY_EMOJI[payload.severity] ?? "";
  const rows = await db
    .select({ subscription: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.userId, pushSubscriptions.userId), eq(teamMembers.teamId, payload.teamId))
    );
  const subscriptions = rows.map((row) => row.subscription);

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
