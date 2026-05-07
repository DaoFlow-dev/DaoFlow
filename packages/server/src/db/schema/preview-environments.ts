import {
  integer,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { environments, projects } from "./projects";
import { services } from "./services";
import { teams } from "./teams";

export const previewEnvironments = pgTable(
  "preview_environments",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 32 })
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    serviceId: varchar("service_id", { length: 32 })
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    providerType: varchar("provider_type", { length: 20 }).default("manual").notNull(),
    previewKey: varchar("preview_key", { length: 120 }).notNull(),
    target: varchar("target", { length: 20 }).notNull(),
    branch: varchar("branch", { length: 255 }).notNull(),
    pullRequestNumber: integer("pull_request_number"),
    envBranch: varchar("env_branch", { length: 255 }).notNull(),
    stackName: varchar("stack_name", { length: 80 }).notNull(),
    primaryDomain: varchar("primary_domain", { length: 255 }),
    status: varchar("status", { length: 20 }).default("deploying").notNull(),
    cleanupStatus: varchar("cleanup_status", { length: 20 }).default("not_requested").notNull(),
    lastDeploymentId: varchar("last_deployment_id", { length: 32 }),
    lastDeploymentStatus: varchar("last_deployment_status", { length: 20 }),
    lastDeploymentConclusion: varchar("last_deployment_conclusion", { length: 20 }),
    lastDeploymentAction: varchar("last_deployment_action", { length: 20 })
      .default("deploy")
      .notNull(),
    lastDeploymentAt: timestamp("last_deployment_at"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    staleAt: timestamp("stale_at"),
    cleanupRequestedAt: timestamp("cleanup_requested_at"),
    cleanupCompletedAt: timestamp("cleanup_completed_at"),
    cleanupDeploymentId: varchar("cleanup_deployment_id", { length: 32 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("preview_envs_service_key_idx").on(table.serviceId, table.previewKey),
    index("preview_envs_team_status_idx").on(table.teamId, table.status),
    index("preview_envs_project_idx").on(table.projectId),
    index("preview_envs_environment_idx").on(table.environmentId),
    index("preview_envs_service_idx").on(table.serviceId),
    index("preview_envs_last_deployment_idx").on(table.lastDeploymentId),
    index("preview_envs_cleanup_status_idx").on(table.cleanupStatus)
  ]
);
