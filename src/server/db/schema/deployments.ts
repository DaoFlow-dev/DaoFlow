import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { servers } from "./servers";
import { users } from "./users";

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
    serviceName: varchar("service_name", { length: 80 }).notNull(),
    sourceType: varchar("source_type", { length: 20 }).notNull(), // compose | dockerfile | image
    commitSha: varchar("commit_sha", { length: 40 }),
    imageTag: varchar("image_tag", { length: 160 }),
    configSnapshot: jsonb("config_snapshot").default({}).notNull(),
    envVarsEncrypted: text("env_vars_encrypted"),
    status: varchar("status", { length: 20 }).default("queued").notNull(), // queued | prepare | deploy | finalize | completed | failed
    conclusion: varchar("conclusion", { length: 20 }), // succeeded | failed | canceled | skipped
    trigger: varchar("trigger", { length: 20 }).default("user").notNull(), // user | webhook | api | agent
    requestedByUserId: serial("requested_by_user_id").references(
      () => users.id,
      { onDelete: "set null" }
    ),
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
    index("deployments_status_idx").on(table.status),
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
  (table) => [
    index("deployment_steps_deployment_id_idx").on(table.deploymentId)
  ]
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
  logs: many(deploymentLogs)
}));

export const deploymentStepsRelations = relations(
  deploymentSteps,
  ({ one }) => ({
    deployment: one(deployments, {
      fields: [deploymentSteps.deploymentId],
      references: [deployments.id]
    })
  })
);

export const deploymentLogsRelations = relations(
  deploymentLogs,
  ({ one }) => ({
    deployment: one(deployments, {
      fields: [deploymentLogs.deploymentId],
      references: [deployments.id]
    })
  })
);
