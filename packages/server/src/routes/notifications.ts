/**
 * Task #63: tRPC routes for push subscription management.
 * Task #70: Notification routes aggregation.
 *
 * Provides subscribe, unsubscribe, and list push subscriptions,
 * plus notification channel CRUD and preference management.
 */
import { z } from "zod";
import { t, protectedProcedure } from "../trpc";
import {
  createNotificationChannel,
  deleteNotificationChannel,
  listNotificationChannels,
  listNotificationDeliveryLogs,
  listProjectNotificationOverrides,
  listPushSubscriptionsForUser,
  listUserNotificationPreferences,
  setProjectNotificationOverride,
  setUserNotificationPreference,
  subscribePushSubscription,
  toggleNotificationChannel,
  unsubscribePushSubscription,
  updateNotificationChannel
} from "../db/services/notifications";

export const notificationRouter = t.router({
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
    .mutation(async ({ ctx, input }) =>
      subscribePushSubscription(ctx.session.user.id, input.subscription)
    ),

  unsubscribePush: protectedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ ctx, input }) =>
      unsubscribePushSubscription(ctx.session.user.id, input.endpoint)
    ),

  listPushSubscriptions: protectedProcedure.query(async ({ ctx }) =>
    listPushSubscriptionsForUser(ctx.session.user.id)
  ),

  listChannels: protectedProcedure.query(async () => listNotificationChannels()),

  createChannel: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        channelType: z.enum(["slack", "discord", "email", "generic_webhook", "web_push"]),
        webhookUrl: z.string().url().optional(),
        email: z.string().email().optional(),
        eventSelectors: z.array(z.string()).default(["*"]),
        enabled: z.boolean().default(true)
      })
    )
    .mutation(async ({ input }) => createNotificationChannel(input)),

  deleteChannel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => deleteNotificationChannel(input.id)),

  updateChannel: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        webhookUrl: z.string().url().optional().nullable(),
        eventSelectors: z.array(z.string()).optional(),
        enabled: z.boolean().optional()
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      return updateNotificationChannel(id, updates);
    }),

  toggleChannel: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }) => toggleNotificationChannel(input.id, input.enabled)),

  getUserPreferences: protectedProcedure.query(async ({ ctx }) =>
    listUserNotificationPreferences(ctx.session.user.id)
  ),

  setUserPreference: protectedProcedure
    .input(
      z.object({
        eventType: z.string(),
        channelType: z.string(),
        enabled: z.boolean()
      })
    )
    .mutation(async ({ ctx, input }) =>
      setUserNotificationPreference({
        userId: ctx.session.user.id,
        ...input
      })
    ),

  getProjectOverrides: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) =>
      listProjectNotificationOverrides({
        userId: ctx.session.user.id,
        projectId: input.projectId
      })
    ),

  setProjectOverride: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        eventType: z.string(),
        channelType: z.string(),
        enabled: z.boolean()
      })
    )
    .mutation(async ({ ctx, input }) =>
      setProjectNotificationOverride({
        userId: ctx.session.user.id,
        ...input
      })
    ),

  listDeliveryLogs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => listNotificationDeliveryLogs(input.limit))
});
