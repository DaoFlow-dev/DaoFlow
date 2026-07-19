import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { servers } from "./servers";
import { users } from "./users";
import { webhookDeliveries } from "./webhook-deliveries";

export const deployments = pgTable(
  "deployments",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 32 }).notNull(),
    targetServerId: varchar("target_server_id", { length: 32 })
      .notNull()
      .references(() => servers.id),
    // This is intentionally not a foreign key: deployment history must retain
    // the service identity after the service itself has been removed.
    serviceId: varchar("service_id", { length: 32 }).notNull(),
    serviceName: varchar("service_name", { length: 80 }).notNull(),
    sourceType: varchar("source_type", { length: 20 }).notNull(), // compose | dockerfile | image
    commitSha: varchar("commit_sha", { length: 40 }),
    imageTag: varchar("image_tag", { length: 160 }),
    configSnapshot: jsonb("config_snapshot").default({}).notNull(),
    envVarsEncrypted: text("env_vars_encrypted"),
    status: varchar("status", { length: 20 }).default("queued").notNull(), // queued | prepare | deploy | finalize | completed | failed
    conclusion: varchar("conclusion", { length: 20 }), // succeeded | failed | canceled | skipped
    trigger: varchar("trigger", { length: 20 }).default("user").notNull(), // user | webhook | api | agent
    webhookDeliveryId: varchar("webhook_delivery_id", { length: 32 }).references(
      () => webhookDeliveries.id,
      { onDelete: "set null" }
    ),
    webhookTargetKey: varchar("webhook_target_key", { length: 80 }),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    requestedByEmail: varchar("requested_by_email", { length: 320 }),
    requestedByRole: varchar("requested_by_role", { length: 20 }),
    containerId: varchar("container_id", { length: 64 }),
    error: jsonb("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    concludedAt: timestamp("concluded_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("deployments_project_id_idx").on(table.projectId),
    index("deployments_environment_id_idx").on(table.environmentId),
    index("deployments_server_id_idx").on(table.targetServerId),
    index("deployments_service_id_idx").on(table.serviceId),
    index("deployments_status_idx").on(table.status),
    uniqueIndex("deployments_webhook_delivery_target_idx").on(
      table.webhookDeliveryId,
      table.webhookTargetKey
    ),
    index("deployments_created_at_idx").on(table.createdAt)
  ]
);

export const deploymentSteps = pgTable(
  "deployment_steps",
  {
    id: serial("id").primaryKey(),
    deploymentId: varchar("deployment_id", { length: 32 })
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    detail: text("detail"),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    sortOrder: serial("sort_order").notNull()
  },
  (table) => [index("deployment_steps_deployment_id_idx").on(table.deploymentId)]
);

export const deploymentLogs = pgTable(
  "deployment_logs",
  {
    id: serial("id").primaryKey(),
    deploymentId: varchar("deployment_id", { length: 32 })
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    level: varchar("level", { length: 10 }).default("info").notNull(), // info | warn | error | debug
    message: text("message").notNull(),
    source: varchar("source", { length: 40 }), // build | runtime | system
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("deployment_logs_deployment_id_idx").on(table.deploymentId),
    index("deployment_logs_created_at_idx").on(table.createdAt)
  ]
);

export const deploymentBuildLeases = pgTable(
  "deployment_build_leases",
  {
    deploymentId: varchar("deployment_id", { length: 32 })
      .primaryKey()
      .references(() => deployments.id, { onDelete: "cascade" }),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    ownerToken: varchar("owner_token", { length: 64 }).notNull(),
    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
    heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull()
  },
  (table) => [
    index("deployment_build_leases_server_id_idx").on(table.serverId),
    index("deployment_build_leases_server_expires_at_idx").on(table.serverId, table.expiresAt),
    index("deployment_build_leases_expires_at_idx").on(table.expiresAt)
  ]
);

export const deploymentQueueReservations = pgTable(
  "deployment_queue_reservations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull()
  },
  (table) => [
    index("deployment_queue_reservations_server_id_idx").on(table.serverId),
    index("deployment_queue_reservations_server_expires_at_idx").on(
      table.serverId,
      table.expiresAt
    ),
    index("deployment_queue_reservations_expires_at_idx").on(table.expiresAt)
  ]
);

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  project: one(projects, {
    fields: [deployments.projectId],
    references: [projects.id]
  }),
  targetServer: one(servers, {
    fields: [deployments.targetServerId],
    references: [servers.id]
  }),
  requestedByUser: one(users, {
    fields: [deployments.requestedByUserId],
    references: [users.id]
  }),
  steps: many(deploymentSteps),
  logs: many(deploymentLogs),
  buildLease: one(deploymentBuildLeases, {
    fields: [deployments.id],
    references: [deploymentBuildLeases.deploymentId]
  })
}));

export const deploymentStepsRelations = relations(deploymentSteps, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentSteps.deploymentId],
    references: [deployments.id]
  })
}));

export const deploymentLogsRelations = relations(deploymentLogs, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentLogs.deploymentId],
    references: [deployments.id]
  })
}));

export const deploymentBuildLeasesRelations = relations(deploymentBuildLeases, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentBuildLeases.deploymentId],
    references: [deployments.id]
  }),
  server: one(servers, {
    fields: [deploymentBuildLeases.serverId],
    references: [servers.id]
  })
}));

export const deploymentQueueReservationsRelations = relations(
  deploymentQueueReservations,
  ({ one }) => ({
    server: one(servers, {
      fields: [deploymentQueueReservations.serverId],
      references: [servers.id]
    })
  })
);
