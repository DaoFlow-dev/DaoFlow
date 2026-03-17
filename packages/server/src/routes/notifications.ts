/**
 * Task #63: tRPC routes for push subscription management.
 * Task #70: Notification routes aggregation.
 *
 * Provides subscribe, unsubscribe, and list push subscriptions,
 * plus notification channel CRUD and preference management.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { t, protectedProcedure } from "../trpc";
import { db } from "../db/connection";
import {
  notificationChannels,
  notificationLogs,
  pushSubscriptions,
  userNotificationPreferences,
  projectNotificationOverrides
} from "../db/schema/notifications";
import { newId } from "../db/services/json-helpers";

export const notificationRouter = t.router({
  // ── Push Subscription Management ─────────────────────────

  subscribePush: protectedProcedure
    .input(
      z.object({
        subscription: z.object({
          endpoint: z.string().url(),
          keys: z.object({
            p256dh: z.string(),
            auth: z.string()
          })
        })
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { endpoint, keys } = input.subscription;

      // Upsert: remove old sub for same endpoint, insert new
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      await db.insert(pushSubscriptions).values({
        id: newId(),
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: "web",
        createdAt: new Date()
      });

      return { ok: true };
    }),

  unsubscribePush: protectedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint));
      return { ok: true };
    }),

  listPushSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.session.user.id));
    return subs.map((s) => ({
      id: s.id,
      endpoint: s.endpoint,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString()
    }));
  }),

  // ── Notification Channel CRUD ─────────────────────────────

  listChannels: protectedProcedure.query(async () => {
    return db.select().from(notificationChannels);
  }),

  createChannel: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        channelType: z.string(),
        webhookUrl: z.string().optional(),
        eventSelectors: z.array(z.string()).default(["*"]),
        enabled: z.boolean().default(true)
      })
    )
    .mutation(async ({ input }) => {
      const id = newId();
      await db.insert(notificationChannels).values({
        id,
        name: input.name,
        channelType: input.channelType,
        webhookUrl: input.webhookUrl ?? null,
        eventSelectors: input.eventSelectors,
        enabled: input.enabled,
        createdAt: new Date()
      });
      return { id };
    }),

  deleteChannel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(notificationChannels).where(eq(notificationChannels.id, input.id));
      return { ok: true };
    }),

  // ── Notification Preferences ──────────────────────────────

  getUserPreferences: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, ctx.session.user.id));
  }),

  setUserPreference: protectedProcedure
    .input(
      z.object({
        eventType: z.string(),
        channelType: z.string(),
        enabled: z.boolean()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      // Delete existing, then insert
      await db
        .delete(userNotificationPreferences)
        .where(
          and(
            eq(userNotificationPreferences.userId, userId),
            eq(userNotificationPreferences.eventType, input.eventType),
            eq(userNotificationPreferences.channelType, input.channelType)
          )
        );
      await db.insert(userNotificationPreferences).values({
        id: newId(),
        userId,
        eventType: input.eventType,
        channelType: input.channelType,
        enabled: input.enabled,
        createdAt: new Date()
      });
      return { ok: true };
    }),

  getProjectOverrides: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(projectNotificationOverrides)
        .where(
          and(
            eq(projectNotificationOverrides.userId, ctx.session.user.id),
            eq(projectNotificationOverrides.projectId, input.projectId)
          )
        );
    }),

  setProjectOverride: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        eventType: z.string(),
        channelType: z.string(),
        enabled: z.boolean()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await db
        .delete(projectNotificationOverrides)
        .where(
          and(
            eq(projectNotificationOverrides.userId, userId),
            eq(projectNotificationOverrides.projectId, input.projectId),
            eq(projectNotificationOverrides.eventType, input.eventType),
            eq(projectNotificationOverrides.channelType, input.channelType)
          )
        );
      await db.insert(projectNotificationOverrides).values({
        id: newId(),
        userId,
        projectId: input.projectId,
        eventType: input.eventType,
        channelType: input.channelType,
        enabled: input.enabled,
        createdAt: new Date()
      });
      return { ok: true };
    }),

  // ── Notification Logs ─────────────────────────────────────

  listDeliveryLogs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const { desc } = await import("drizzle-orm");
      return db
        .select()
        .from(notificationLogs)
        .orderBy(desc(notificationLogs.sentAt))
        .limit(input.limit);
    })
});
