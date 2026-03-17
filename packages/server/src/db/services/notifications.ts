import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import {
  notificationChannels,
  notificationLogs,
  projectNotificationOverrides,
  pushSubscriptions,
  userNotificationPreferences
} from "../schema/notifications";
import { newId } from "./json-helpers";

export async function subscribePushSubscription(
  userId: string,
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }
) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  await db.insert(pushSubscriptions).values({
    id: newId(),
    userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    userAgent: "web",
    createdAt: new Date()
  });

  return { ok: true as const };
}

export async function unsubscribePushSubscription(userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
  return { ok: true as const };
}

export async function listPushSubscriptionsForUser(userId: string) {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return subs.map((sub) => ({
    id: sub.id,
    endpoint: sub.endpoint,
    userAgent: sub.userAgent,
    createdAt: sub.createdAt.toISOString()
  }));
}

export async function listNotificationChannels() {
  const channels = await db
    .select()
    .from(notificationChannels)
    .orderBy(desc(notificationChannels.createdAt));

  return channels.map((channel) => ({
    ...channel,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString()
  }));
}

export async function createNotificationChannel(input: {
  name: string;
  channelType: "slack" | "discord" | "email" | "generic_webhook" | "web_push";
  webhookUrl?: string;
  email?: string;
  eventSelectors: string[];
  enabled: boolean;
}) {
  const id = newId();
  await db.insert(notificationChannels).values({
    id,
    name: input.name,
    channelType: input.channelType,
    webhookUrl: input.webhookUrl ?? null,
    email: input.email ?? null,
    eventSelectors: input.eventSelectors,
    enabled: input.enabled,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { id };
}

export async function deleteNotificationChannel(id: string) {
  await db.delete(notificationChannels).where(eq(notificationChannels.id, id));
  return { ok: true as const };
}

export async function updateNotificationChannel(
  id: string,
  updates: {
    name?: string;
    webhookUrl?: string | null;
    eventSelectors?: string[];
    enabled?: boolean;
  }
) {
  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) setValues.name = updates.name;
  if (updates.webhookUrl !== undefined) setValues.webhookUrl = updates.webhookUrl;
  if (updates.eventSelectors !== undefined) setValues.eventSelectors = updates.eventSelectors;
  if (updates.enabled !== undefined) setValues.enabled = updates.enabled;

  await db.update(notificationChannels).set(setValues).where(eq(notificationChannels.id, id));
  return { ok: true as const };
}

export async function toggleNotificationChannel(id: string, enabled: boolean) {
  await db
    .update(notificationChannels)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(notificationChannels.id, id));
  return { ok: true as const };
}

export async function listUserNotificationPreferences(userId: string) {
  const prefs = await db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));

  return prefs.map((pref) => ({
    ...pref,
    createdAt: pref.createdAt.toISOString(),
    updatedAt: pref.updatedAt.toISOString()
  }));
}

export async function setUserNotificationPreference(input: {
  userId: string;
  eventType: string;
  channelType: string;
  enabled: boolean;
}) {
  await db
    .delete(userNotificationPreferences)
    .where(
      and(
        eq(userNotificationPreferences.userId, input.userId),
        eq(userNotificationPreferences.eventType, input.eventType),
        eq(userNotificationPreferences.channelType, input.channelType)
      )
    );

  await db.insert(userNotificationPreferences).values({
    id: newId(),
    userId: input.userId,
    eventType: input.eventType,
    channelType: input.channelType,
    enabled: input.enabled,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { ok: true as const };
}

export async function listProjectNotificationOverrides(input: {
  userId: string;
  projectId: string;
}) {
  const overrides = await db
    .select()
    .from(projectNotificationOverrides)
    .where(
      and(
        eq(projectNotificationOverrides.userId, input.userId),
        eq(projectNotificationOverrides.projectId, input.projectId)
      )
    );

  return overrides.map((override) => ({
    ...override,
    createdAt: override.createdAt.toISOString(),
    updatedAt: override.updatedAt.toISOString()
  }));
}

export async function setProjectNotificationOverride(input: {
  userId: string;
  projectId: string;
  eventType: string;
  channelType: string;
  enabled: boolean;
}) {
  await db
    .delete(projectNotificationOverrides)
    .where(
      and(
        eq(projectNotificationOverrides.userId, input.userId),
        eq(projectNotificationOverrides.projectId, input.projectId),
        eq(projectNotificationOverrides.eventType, input.eventType),
        eq(projectNotificationOverrides.channelType, input.channelType)
      )
    );

  await db.insert(projectNotificationOverrides).values({
    id: newId(),
    userId: input.userId,
    projectId: input.projectId,
    eventType: input.eventType,
    channelType: input.channelType,
    enabled: input.enabled,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { ok: true as const };
}

export async function listNotificationDeliveryLogs(limit = 20) {
  const logs = await db
    .select()
    .from(notificationLogs)
    .orderBy(desc(notificationLogs.sentAt))
    .limit(limit);

  const channelIds = [...new Set(logs.map((log) => log.channelId))];
  const channels =
    channelIds.length > 0
      ? await db
          .select()
          .from(notificationChannels)
          .where(inArray(notificationChannels.id, channelIds))
      : [];
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));

  return logs.map((log) => ({
    ...log,
    sentAt: log.sentAt.toISOString(),
    channelName: channelById.get(log.channelId)?.name ?? log.channelId,
    channelType: channelById.get(log.channelId)?.channelType ?? "unknown"
  }));
}
