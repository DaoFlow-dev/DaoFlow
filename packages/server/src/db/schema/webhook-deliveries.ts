import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

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
    index("webhook_deliveries_created_at_idx").on(table.createdAt)
  ]
);
