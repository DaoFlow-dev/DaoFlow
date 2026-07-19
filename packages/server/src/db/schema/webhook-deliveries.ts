import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    providerType: varchar("provider_type", { length: 20 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    deliveryKey: varchar("delivery_key", { length: 200 }).notNull(),
    deliveryId: varchar("delivery_id", { length: 200 }),
    repoFullName: varchar("repo_full_name", { length: 255 }),
    externalInstallationId: varchar("external_installation_id", { length: 40 }),
    previewKey: varchar("preview_key", { length: 80 }),
    previewAction: varchar("preview_action", { length: 20 }),
    commitSha: varchar("commit_sha", { length: 64 }),
    // Legacy deliveries can predate the recovery service, so this remains nullable.
    // The recovery service always persists a SHA-256 digest and never the raw body.
    bodyDigest: varchar("body_digest", { length: 64 }),
    currentAttemptId: varchar("current_attempt_id", { length: 32 }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorSummary: text("last_error_summary"),
    status: varchar("status", { length: 20 }).default("processing").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at")
  },
  (table) => [
    uniqueIndex("webhook_deliveries_provider_key_idx").on(table.providerType, table.deliveryKey),
    index("webhook_deliveries_repo_idx").on(table.repoFullName),
    index("webhook_deliveries_status_idx").on(table.status),
    index("webhook_deliveries_recovery_status_seen_idx").on(table.status, table.lastSeenAt),
    index("webhook_deliveries_created_at_idx").on(table.createdAt)
  ]
);

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    deliveryId: varchar("delivery_id", { length: 32 })
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: varchar("status", { length: 20 }).default("processing").notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at").notNull(),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("webhook_delivery_attempts_delivery_number_idx").on(
      table.deliveryId,
      table.attemptNumber
    ),
    index("webhook_delivery_attempts_delivery_status_idx").on(table.deliveryId, table.status),
    index("webhook_delivery_attempts_lease_expiry_idx").on(table.leaseExpiresAt)
  ]
);

export const webhookDeliveryTargets = pgTable(
  "webhook_delivery_targets",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    deliveryId: varchar("delivery_id", { length: 32 })
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    targetKey: varchar("target_key", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    lastAttemptId: varchar("last_attempt_id", { length: 32 }).references(
      () => webhookDeliveryAttempts.id,
      { onDelete: "set null" }
    ),
    detail: text("detail"),
    errorSummary: text("error_summary"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("webhook_delivery_targets_delivery_key_idx").on(table.deliveryId, table.targetKey),
    index("webhook_delivery_targets_retry_idx").on(table.deliveryId, table.status)
  ]
);
