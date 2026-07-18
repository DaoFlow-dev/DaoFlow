import {
  boolean,
  foreignKey,
  integer,
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
import { gitProviders, gitInstallations } from "./git-providers";

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
    gitProviderId: varchar("git_provider_id", { length: 32 }).references(() => gitProviders.id, {
      onDelete: "set null"
    }),
    gitInstallationId: varchar("git_installation_id", { length: 32 }).references(
      () => gitInstallations.id,
      { onDelete: "set null" }
    ),
    defaultBranch: varchar("default_branch", { length: 80 }).default("main"),
    autoDeploy: boolean("auto_deploy").default(false).notNull(),
    autoDeployBranch: varchar("auto_deploy_branch", { length: 120 }),
    previewPolicy: varchar("preview_policy", { length: 40 }).default("manual-approval").notNull(),
    previewPolicyRevision: integer("preview_policy_revision").default(1).notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.gitProviderId, table.teamId],
      foreignColumns: [gitProviders.id, gitProviders.teamId],
      name: "projects_git_provider_id_team_id_git_providers_id_team_id_fk"
    }),
    foreignKey({
      columns: [table.gitInstallationId, table.teamId],
      foreignColumns: [gitInstallations.id, gitInstallations.teamId],
      name: "projects_git_installation_id_team_id_git_installations_id_team_id_fk"
    }),
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

export const repositoryCredentials = pgTable(
  "repository_credentials",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(), // https_token | https_basic | ssh_key
    usernameEncrypted: text("username_encrypted"),
    passwordEncrypted: text("password_encrypted"),
    tokenEncrypted: text("token_encrypted"),
    privateKeyEncrypted: text("private_key_encrypted"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("repository_credentials_project_idx").on(table.projectId),
    index("repository_credentials_project_status_idx").on(table.projectId, table.status)
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
    source: varchar("source", { length: 20 }).default("inline").notNull(), // inline | 1password
    secretRef: text("secret_ref"), // op://vault/item/field URI when source is "1password"
    branchPattern: varchar("branch_pattern", { length: 120 }).default("").notNull(),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("env_vars_environment_id_idx").on(table.environmentId),
    uniqueIndex("env_vars_env_key_branch_idx").on(
      table.environmentId,
      table.key,
      table.branchPattern
    )
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

export const repositoryCredentialsRelations = relations(repositoryCredentials, ({ one }) => ({
  project: one(projects, {
    fields: [repositoryCredentials.projectId],
    references: [projects.id]
  })
}));
