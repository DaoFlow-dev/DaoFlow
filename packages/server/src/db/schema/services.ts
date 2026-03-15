import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects, environments } from "./projects";
import { servers } from "./servers";

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

export const servicesRelations = relations(services, ({ one }) => ({
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
  })
}));
