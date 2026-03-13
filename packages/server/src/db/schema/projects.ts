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
import { teams } from "./teams";
import { users } from "./users";

export const projects = pgTable(
  "projects",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 40 }),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    repoFullName: varchar("repo_full_name", { length: 255 }),
    repoUrl: text("repo_url"),
    sourceType: varchar("source_type", { length: 20 }).default("compose").notNull(), // compose | dockerfile | image
    composePath: text("compose_path"),
    config: jsonb("config").default({}).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(), // active | paused | deleted
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("projects_slug_idx").on(table.slug),
    index("projects_team_id_idx").on(table.teamId),
    index("projects_name_idx").on(table.name),
    index("projects_created_at_idx").on(table.createdAt)
  ]
);

export const environments = pgTable(
  "environments",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 40 }).notNull(),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    config: jsonb("config").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("environments_project_id_idx").on(table.projectId),
    uniqueIndex("environments_project_slug_idx").on(table.projectId, table.slug)
  ]
);

export const environmentVariables = pgTable(
  "environment_variables",
  {
    id: serial("id").primaryKey(),
    environmentId: varchar("environment_id", { length: 32 })
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 80 }).notNull(),
    valueEncrypted: text("value_encrypted").notNull(),
    isSecret: varchar("is_secret", { length: 5 }).default("false").notNull(),
    category: varchar("category", { length: 20 }).default("runtime").notNull(), // runtime | build
    branchPattern: varchar("branch_pattern", { length: 120 }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("env_vars_environment_id_idx").on(table.environmentId),
    uniqueIndex("env_vars_env_key_idx").on(table.environmentId, table.key)
  ]
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, {
    fields: [projects.teamId],
    references: [teams.id]
  }),
  createdByUser: one(users, {
    fields: [projects.createdByUserId],
    references: [users.id]
  }),
  environments: many(environments)
}));

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  project: one(projects, {
    fields: [environments.projectId],
    references: [projects.id]
  }),
  variables: many(environmentVariables)
}));

export const environmentVariablesRelations = relations(environmentVariables, ({ one }) => ({
  environment: one(environments, {
    fields: [environmentVariables.environmentId],
    references: [environments.id]
  }),
  updatedByUser: one(users, {
    fields: [environmentVariables.updatedByUserId],
    references: [users.id]
  })
}));
