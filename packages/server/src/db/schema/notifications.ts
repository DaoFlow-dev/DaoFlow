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

// ── Push Subscriptions Table (Web Push / PWA) ───────────────
// Task #60: Stores VAPID push subscriptions per user/browser

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: text("user_id").notNull(),
    /** Web Push endpoint URL */
    endpoint: text("endpoint").notNull(),
    /** VAPID p256dh key */
    p256dh: text("p256dh").notNull(),
    /** VAPID auth secret */
    auth: text("auth").notNull(),
    /** User-agent / browser label for UI display */
    userAgent: text("user_agent"),
    /** When the last push was sent successfully */
    lastPushedAt: timestamp("last_pushed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("push_subscriptions_user_id_idx").on(table.userId),
    index("push_subscriptions_endpoint_idx").on(table.endpoint)
  ]
);

// ── User Notification Preferences ───────────────────────────
// Task #64: Top-level user defaults for which events/channels are enabled

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: text("user_id").notNull(),
    /**
     * Channel type this preference applies to: web_push, slack, discord, email, webhook
     * Use "*" for all channels
     */
    channelType: varchar("channel_type", { length: 20 }).notNull(),
    /**
     * Event type this preference applies to: backup.failed, deploy.*, etc.
     * Supports wildcards
     */
    eventType: varchar("event_type", { length: 60 }).notNull(),
    /** Whether this event+channel combination is enabled */
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("user_notification_prefs_user_id_idx").on(table.userId),
    index("user_notification_prefs_channel_type_idx").on(table.channelType)
  ]
);

// ── Project Notification Overrides ──────────────────────────
// Task #65: Project-level overrides that cascade over user defaults

export const projectNotificationOverrides = pgTable(
  "project_notification_overrides",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    /** Project this override applies to */
    projectId: varchar("project_id", { length: 32 }).notNull(),
    /** User who set this override (or null for project-wide default) */
    userId: text("user_id"),
    /**
     * Channel type: web_push, slack, discord, email, webhook, *
     */
    channelType: varchar("channel_type", { length: 20 }).notNull(),
    /**
     * Event type with wildcard support: backup.*, deploy.failed, etc.
     */
    eventType: varchar("event_type", { length: 60 }).notNull(),
    /** Override value: true = force enable, false = force disable */
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("project_notification_overrides_project_id_idx").on(table.projectId),
    index("project_notification_overrides_user_id_idx").on(table.userId)
  ]
);
