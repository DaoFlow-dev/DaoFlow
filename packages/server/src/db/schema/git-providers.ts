import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Git Providers — registered GitHub/GitLab App credentials.
 * Each provider represents a single GitHub App or GitLab OAuth app.
 */
export const gitProviders = pgTable(
  "git_providers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    type: varchar("type", { length: 20 }).default("github").notNull(), // github | gitlab
    name: varchar("name", { length: 100 }).notNull(), // human-readable label
    appId: varchar("app_id", { length: 40 }), // GitHub App ID
    clientId: varchar("client_id", { length: 80 }),
    clientSecretEncrypted: text("client_secret_encrypted"),
    privateKeyEncrypted: text("private_key_encrypted"), // GitHub App PEM key
    webhookSecret: varchar("webhook_secret", { length: 128 }),
    baseUrl: varchar("base_url", { length: 255 }), // for GitHub Enterprise / GitLab self-hosted
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("git_providers_type_idx").on(table.type),
    uniqueIndex("git_providers_name_idx").on(table.name)
  ]
);

/**
 * Git Installations — per-org installations of a GitHub/GitLab App.
 * Created when a user installs the GitHub App on their org.
 */
export const gitInstallations = pgTable(
  "git_installations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    providerId: varchar("provider_id", { length: 32 })
      .notNull()
      .references(() => gitProviders.id, { onDelete: "cascade" }),
    installationId: varchar("installation_id", { length: 40 }).notNull(), // GitHub installation ID
    accountName: varchar("account_name", { length: 100 }).notNull(), // org or user name
    accountType: varchar("account_type", { length: 20 }).default("organization").notNull(),
    repositorySelection: varchar("repository_selection", { length: 20 }).default("all").notNull(), // all | selected
    permissions: text("permissions"), // JSON string of granted permissions
    status: varchar("status", { length: 20 }).default("active").notNull(),
    installedByUserId: text("installed_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("git_installations_provider_id_idx").on(table.providerId),
    uniqueIndex("git_installations_provider_install_idx").on(table.providerId, table.installationId)
  ]
);

export const gitProvidersRelations = relations(gitProviders, ({ many }) => ({
  installations: many(gitInstallations)
}));

export const gitInstallationsRelations = relations(gitInstallations, ({ one }) => ({
  provider: one(gitProviders, {
    fields: [gitInstallations.providerId],
    references: [gitProviders.id]
  })
}));

/**
 * Project-level git settings (added as columns to the projects table via
 * a separate migration, but modeled here as a reference).
 *
 * Fields to add to projects:
 * - gitProviderId → FK to gitProviders
 * - gitInstallationId → FK to gitInstallations
 * - repoFullName (e.g. "DaoFlow-dev/DaoFlow")
 * - defaultBranch (default "main")
 * - autoDeploy (boolean, default false)
 * - autoDeployBranch (varchar)
 */
