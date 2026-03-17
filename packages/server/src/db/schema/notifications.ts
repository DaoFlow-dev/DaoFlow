import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Notification Event Types ────────────────────────────────
// These are the events users can subscribe to via selectors.
// Format: "domain.action" with wildcard support ("backup.*")

export const NOTIFICATION_EVENT_TYPES = [
  // Backup events
  "backup.started",
  "backup.succeeded",
  "backup.failed",
  "backup.pruned",

  // Restore events
  "restore.started",
  "restore.succeeded",
  "restore.failed",

  // Deployment events
  "deploy.started",
  "deploy.succeeded",
  "deploy.failed",
  "deploy.rollback",

  // Server events
  "server.connected",
  "server.disconnected",
  "server.health.degraded",

  // Security events
  "security.token.created",
  "security.token.expired",
  "security.login.failed"
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

// ── Notification Channels Table ─────────────────────────────

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    /** Channel type: slack, discord, email, generic_webhook */
    channelType: varchar("channel_type", { length: 20 }).notNull(),
    /** Webhook URL for Slack/Discord/generic webhook */
    webhookUrl: text("webhook_url"),
    /** Email address for email notifications */
    email: text("email"),
    /**
     * Event selectors: JSON array of event patterns.
     * Supports exact match ("backup.failed") and wildcards ("backup.*", "*")
     * Example: ["backup.failed", "deploy.*", "server.health.degraded"]
     */
    eventSelectors: jsonb("event_selectors").default([]).notNull(),
    /** Whether this channel is active */
    enabled: boolean("enabled").default(true).notNull(),
    /** Optional: filter by project/environment (null = all) */
    projectFilter: varchar("project_filter", { length: 100 }),
    environmentFilter: varchar("environment_filter", { length: 100 }),
    /** Metadata for extra config (e.g., Slack channel override, Discord username) */
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("notification_channels_type_idx").on(table.channelType),
    index("notification_channels_enabled_idx").on(table.enabled)
  ]
);

export const notificationChannelsRelations = relations(notificationChannels, () => ({}));

// ── Notification Log Table ──────────────────────────────────

export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    channelId: varchar("channel_id", { length: 32 })
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 60 }).notNull(),
    /** Summary of what was sent */
    payload: jsonb("payload").default({}).notNull(),
    /** HTTP status code from webhook delivery */
    httpStatus: varchar("http_status", { length: 5 }),
    /** Success/failure */
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at").defaultNow().notNull()
  },
  (table) => [
    index("notification_logs_channel_id_idx").on(table.channelId),
    index("notification_logs_event_type_idx").on(table.eventType),
    index("notification_logs_sent_at_idx").on(table.sentAt)
  ]
);

export const notificationLogsRelations = relations(notificationLogs, ({ one }) => ({
  channel: one(notificationChannels, {
    fields: [notificationLogs.channelId],
    references: [notificationChannels.id]
  })
}));
