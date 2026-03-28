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
import { projects, environments } from "./projects";
import { servers } from "./servers";
import { users } from "./users";

/**
 * Services — the runtime units within an environment.
 *
 * A service represents a running Docker container, Docker Compose service,
 * or Dockerfile-based deploy target. It is the atomic deployable unit.
 */
export const services = pgTable(
  "services",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 40 }).notNull(),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 32 })
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    targetServerId: varchar("target_server_id", { length: 32 }).references(() => servers.id, {
      onDelete: "set null"
    }),
    sourceType: varchar("source_type", { length: 20 }).default("compose").notNull(),
    imageReference: varchar("image_reference", { length: 255 }),
    dockerfilePath: text("dockerfile_path"),
    composeServiceName: varchar("compose_service_name", { length: 100 }),
    port: varchar("port", { length: 20 }),
    healthcheckPath: varchar("healthcheck_path", { length: 255 }),
    replicaCount: varchar("replica_count", { length: 5 }).default("1").notNull(),
    status: varchar("status", { length: 20 }).default("inactive").notNull(),
    config: jsonb("config").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("services_project_id_idx").on(table.projectId),
    index("services_environment_id_idx").on(table.environmentId),
    uniqueIndex("services_env_slug_idx").on(table.environmentId, table.slug)
  ]
);

export const serviceVariables = pgTable(
  "service_variables",
  {
    id: serial("id").primaryKey(),
    serviceId: varchar("service_id", { length: 32 })
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 80 }).notNull(),
    valueEncrypted: text("value_encrypted").notNull(),
    isSecret: varchar("is_secret", { length: 5 }).default("false").notNull(),
    category: varchar("category", { length: 20 }).default("runtime").notNull(),
    source: varchar("source", { length: 20 }).default("inline").notNull(),
    secretRef: text("secret_ref"),
    branchPattern: varchar("branch_pattern", { length: 120 }).default("").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("service_vars_service_id_idx").on(table.serviceId),
    uniqueIndex("service_vars_service_key_branch_idx").on(
      table.serviceId,
      table.key,
      table.branchPattern
    )
  ]
);

export const servicesRelations = relations(services, ({ one, many }) => ({
  project: one(projects, {
    fields: [services.projectId],
    references: [projects.id]
  }),
  environment: one(environments, {
    fields: [services.environmentId],
    references: [environments.id]
  }),
  targetServer: one(servers, {
    fields: [services.targetServerId],
    references: [servers.id]
  }),
  variables: many(serviceVariables)
}));

export const serviceVariablesRelations = relations(serviceVariables, ({ one }) => ({
  service: one(services, {
    fields: [serviceVariables.serviceId],
    references: [services.id]
  }),
  updatedByUser: one(users, {
    fields: [serviceVariables.updatedByUserId],
    references: [users.id]
  })
}));
