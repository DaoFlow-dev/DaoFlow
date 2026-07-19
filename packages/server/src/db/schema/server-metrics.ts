import { relations, sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { notificationChannels } from "./notifications";
import { servers } from "./servers";

export const serverMetrics = pgTable(
  "server_metrics",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    cpuPercent: doublePrecision("cpu_percent").notNull(),
    memoryUsedPercent: doublePrecision("memory_used_percent").notNull(),
    memoryUsedGB: doublePrecision("memory_used_gb").notNull(),
    memoryTotalGB: doublePrecision("memory_total_gb").notNull(),
    diskUsedPercent: doublePrecision("disk_used_percent").notNull(),
    diskTotalGB: doublePrecision("disk_total_gb").notNull(),
    networkInMB: doublePrecision("network_in_mb").notNull(),
    networkOutMB: doublePrecision("network_out_mb").notNull(),
    dockerDiskUsedPercent: doublePrecision("docker_disk_used_percent"),
    dockerDiskTotalGB: doublePrecision("docker_disk_total_gb"),
    collectedAt: timestamp("collected_at").notNull()
  },
  (table) => [
    index("server_metrics_server_idx").on(table.serverId),
    index("server_metrics_server_collected_idx").on(table.serverId, table.collectedAt),
    index("server_metrics_collected_at_idx").on(table.collectedAt)
  ]
);

export const serverMetricsRelations = relations(serverMetrics, ({ one }) => ({
  server: one(servers, {
    fields: [serverMetrics.serverId],
    references: [servers.id]
  })
}));

/**
 * Per-server metric collection and alerting policy. A missing row uses the
 * defaults in the policy service, allowing existing servers to opt in without
 * a backfill migration.
 */
export const serverMetricPolicies = pgTable(
  "server_metric_policies",
  {
    serverId: varchar("server_id", { length: 32 })
      .primaryKey()
      .references(() => servers.id, { onDelete: "cascade" }),
    sampleIntervalSeconds: integer("sample_interval_seconds").default(60).notNull(),
    retentionDays: integer("retention_days").default(7).notNull(),
    cpuWarnPercent: integer("cpu_warn_percent").default(0).notNull(),
    cpuHardPercent: integer("cpu_hard_percent").default(0).notNull(),
    memoryWarnPercent: integer("memory_warn_percent").default(0).notNull(),
    memoryHardPercent: integer("memory_hard_percent").default(0).notNull(),
    diskWarnPercent: integer("disk_warn_percent").default(0).notNull(),
    diskHardPercent: integer("disk_hard_percent").default(0).notNull(),
    dockerDiskWarnPercent: integer("docker_disk_warn_percent").default(0).notNull(),
    dockerDiskHardPercent: integer("docker_disk_hard_percent").default(0).notNull(),
    cooldownMinutes: integer("cooldown_minutes").default(30).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    check(
      "server_metric_policies_sample_interval_check",
      sql`${table.sampleIntervalSeconds} between 1 and 86400`
    ),
    check("server_metric_policies_retention_check", sql`${table.retentionDays} between 1 and 3650`),
    check(
      "server_metric_policies_cpu_thresholds_check",
      sql`${table.cpuWarnPercent} between 0 and 100 and ${table.cpuHardPercent} between 0 and 100 and (${table.cpuWarnPercent} = 0 or ${table.cpuHardPercent} = 0 or ${table.cpuWarnPercent} <= ${table.cpuHardPercent})`
    ),
    check(
      "server_metric_policies_memory_thresholds_check",
      sql`${table.memoryWarnPercent} between 0 and 100 and ${table.memoryHardPercent} between 0 and 100 and (${table.memoryWarnPercent} = 0 or ${table.memoryHardPercent} = 0 or ${table.memoryWarnPercent} <= ${table.memoryHardPercent})`
    ),
    check(
      "server_metric_policies_disk_thresholds_check",
      sql`${table.diskWarnPercent} between 0 and 100 and ${table.diskHardPercent} between 0 and 100 and (${table.diskWarnPercent} = 0 or ${table.diskHardPercent} = 0 or ${table.diskWarnPercent} <= ${table.diskHardPercent})`
    ),
    check(
      "server_metric_policies_docker_disk_thresholds_check",
      sql`${table.dockerDiskWarnPercent} between 0 and 100 and ${table.dockerDiskHardPercent} between 0 and 100 and (${table.dockerDiskWarnPercent} = 0 or ${table.dockerDiskHardPercent} = 0 or ${table.dockerDiskWarnPercent} <= ${table.dockerDiskHardPercent})`
    ),
    check("server_metric_policies_cooldown_check", sql`${table.cooldownMinutes} between 0 and 1440`)
  ]
);

/**
 * Current threshold state is kept separately from immutable metric samples so
 * monitoring can evaluate transitions without rewriting history.
 */
export const serverMetricStates = pgTable(
  "server_metric_states",
  {
    serverId: varchar("server_id", { length: 32 })
      .primaryKey()
      .references(() => servers.id, { onDelete: "cascade" }),
    currentState: varchar("current_state", { length: 20 }).default("healthy").notNull(),
    metricStates: jsonb("metric_states").default({}).notNull(),
    lastCheckedAt: timestamp("last_checked_at"),
    lastCollectedAt: timestamp("last_collected_at"),
    lastUnreachableAt: timestamp("last_unreachable_at"),
    lastTransitionAt: timestamp("last_transition_at"),
    lastAlertAt: timestamp("last_alert_at"),
    collectionGeneration: integer("collection_generation").default(0).notNull(),
    collectionLeaseOwner: varchar("collection_lease_owner", { length: 32 }),
    collectionLeaseToken: varchar("collection_lease_token", { length: 32 }),
    collectionLeaseExpiresAt: timestamp("collection_lease_expires_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("server_metric_states_current_state_idx").on(table.currentState),
    index("server_metric_states_collection_lease_idx").on(table.collectionLeaseExpiresAt)
  ]
);

/**
 * Durable alert evidence. Every transition is recorded before notification
 * delivery is attempted; retention never targets this table.
 */
export const serverMetricAlerts = pgTable(
  "server_metric_alerts",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    metricKey: varchar("metric_key", { length: 30 }).notNull(),
    eventType: varchar("event_type", { length: 60 }).notNull(),
    transitionType: varchar("transition_type", { length: 20 }).notNull(),
    previousState: varchar("previous_state", { length: 20 }).notNull(),
    nextState: varchar("next_state", { length: 20 }).notNull(),
    measuredValue: doublePrecision("measured_value"),
    thresholdValue: doublePrecision("threshold_value"),
    occurredAt: timestamp("occurred_at").notNull(),
    notifiedAt: timestamp("notified_at")
  },
  (table) => [
    index("server_metric_alerts_server_occurred_idx").on(table.serverId, table.occurredAt),
    index("server_metric_alerts_occurred_idx").on(table.occurredAt)
  ]
);

/**
 * A retryable delivery record for metric transition evidence. The alert row
 * remains immutable evidence while this row tracks the notification outcome.
 */
export const serverMetricOutbox = pgTable(
  "server_metric_outbox",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    alertId: varchar("alert_id", { length: 32 })
      .notNull()
      .references(() => serverMetricAlerts.id, { onDelete: "cascade" }),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 32 })
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    metricKey: varchar("metric_key", { length: 30 }).notNull(),
    eventType: varchar("event_type", { length: 60 }).notNull(),
    status: varchar("status", { length: 30 }).default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at").notNull(),
    leaseOwner: varchar("lease_owner", { length: 32 }),
    leaseToken: varchar("lease_token", { length: 32 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    suppressedAt: timestamp("suppressed_at"),
    sentAt: timestamp("sent_at"),
    terminalFailedAt: timestamp("terminal_failed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("server_metric_outbox_ready_idx").on(table.status, table.nextAttemptAt),
    index("server_metric_outbox_server_event_idx").on(
      table.serverId,
      table.metricKey,
      table.eventType
    ),
    index("server_metric_outbox_channel_idx").on(table.channelId),
    check("server_metric_outbox_attempt_count_check", sql`${table.attemptCount} >= 0`)
  ]
);

/**
 * Serializes cooldown decisions for one server/metric/event tuple across
 * control-plane replicas. A short delivery lease prevents two workers from
 * sending different queued repeats at the same time.
 */
export const serverMetricDeliveryCooldowns = pgTable(
  "server_metric_delivery_cooldowns",
  {
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 32 })
      .notNull()
      .references(() => notificationChannels.id, { onDelete: "cascade" }),
    metricKey: varchar("metric_key", { length: 30 }).notNull(),
    eventType: varchar("event_type", { length: 60 }).notNull(),
    lastDeliveredAt: timestamp("last_delivered_at"),
    deliveryLeaseToken: varchar("delivery_lease_token", { length: 32 }),
    deliveryLeaseExpiresAt: timestamp("delivery_lease_expires_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    primaryKey({
      name: "server_metric_delivery_cooldowns_pkey",
      columns: [table.serverId, table.channelId, table.metricKey, table.eventType]
    }),
    index("server_metric_delivery_cooldowns_lease_idx").on(table.deliveryLeaseExpiresAt)
  ]
);
