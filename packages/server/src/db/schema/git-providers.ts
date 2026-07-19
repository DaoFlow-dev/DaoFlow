import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { teams } from "./teams";

/**
 * Git Providers — registered GitHub/GitLab App credentials.
 * Each provider represents a single GitHub App or GitLab OAuth app.
 */
export const gitProviders = pgTable(
  "git_providers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).default("github").notNull(), // github | gitlab | bitbucket | gitea
    name: varchar("name", { length: 100 }).notNull(), // human-readable label
    appId: varchar("app_id", { length: 40 }), // GitHub App ID
    clientId: varchar("client_id", { length: 80 }),
    clientSecretEncrypted: text("client_secret_encrypted"),
    privateKeyEncrypted: text("private_key_encrypted"), // GitHub App PEM key
    webhookSecret: varchar("webhook_secret", { length: 128 }),
    baseUrl: varchar("base_url", { length: 255 }), // for GitHub Enterprise / GitLab self-hosted
    internalBaseUrl: varchar("internal_base_url", { length: 255 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("git_providers_team_id_idx").on(table.teamId),
    index("git_providers_type_idx").on(table.type),
    uniqueIndex("git_providers_name_team_idx").on(table.name, table.teamId),
    uniqueIndex("git_providers_id_team_id_idx").on(table.id, table.teamId)
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
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 32 })
      .notNull()
      .references(() => gitProviders.id, { onDelete: "cascade" }),
    installationId: varchar("installation_id", { length: 40 }).notNull(), // GitHub installation ID
    accountName: varchar("account_name", { length: 100 }).notNull(), // org or user name
    accountType: varchar("account_type", { length: 20 }).default("organization").notNull(),
    repositorySelection: varchar("repository_selection", { length: 20 }).default("all").notNull(), // all | selected
    permissions: text("permissions"), // JSON string of granted permissions
    credentialKind: varchar("credential_kind", { length: 20 }),
    credentialScopes: text("credential_scopes"),
    credentialExpiresAt: timestamp("credential_expires_at"),
    credentialEncrypted: text("credential_encrypted"),
    credentialEnvelopeVersion: integer("credential_envelope_version"),
    credentialKeyId: varchar("credential_key_id", { length: 64 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    installedByUserId: text("installed_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.providerId, table.teamId],
      foreignColumns: [gitProviders.id, gitProviders.teamId],
      name: "git_installations_provider_id_team_id_git_providers_id_team_id_fk"
    }),
    index("git_installations_team_id_idx").on(table.teamId),
    index("git_installations_provider_id_idx").on(table.providerId),
    uniqueIndex("git_installations_provider_install_idx").on(
      table.providerId,
      table.installationId
    ),
    uniqueIndex("git_installations_id_team_id_idx").on(table.id, table.teamId)
  ]
);

/**
 * Git provider setup states — one-time, short-lived callback binding records.
 * The opaque state is the primary key and is consumed atomically by the callback.
 */
export const gitProviderSetupStates = pgTable(
  "git_provider_setup_states",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 32 }).references(() => gitProviders.id, {
      onDelete: "cascade"
    }),
    providerType: varchar("provider_type", { length: 20 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    callbackOrigin: varchar("callback_origin", { length: 255 }).notNull(),
    providerPublicBaseUrl: varchar("provider_public_base_url", { length: 255 }),
    codeVerifierEncrypted: text("code_verifier_encrypted"),
    initiatedByUserId: text("initiated_by_user_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.providerId, table.teamId],
      foreignColumns: [gitProviders.id, gitProviders.teamId],
      name: "git_provider_setup_states_provider_id_team_id_git_providers_id_team_id_fk"
    }).onDelete("cascade"),
    index("git_provider_setup_states_team_id_idx").on(table.teamId),
    index("git_provider_setup_states_provider_id_idx").on(table.providerId),
    index("git_provider_setup_states_expires_at_idx").on(table.expiresAt),
    index("git_provider_setup_states_initiated_by_user_id_idx").on(table.initiatedByUserId)
  ]
);

export const gitProvidersRelations = relations(gitProviders, ({ many }) => ({
  installations: many(gitInstallations),
  setupStates: many(gitProviderSetupStates)
}));

export const gitInstallationsRelations = relations(gitInstallations, ({ one }) => ({
  provider: one(gitProviders, {
    fields: [gitInstallations.providerId],
    references: [gitProviders.id]
  })
}));

export const gitProviderSetupStatesRelations = relations(gitProviderSetupStates, ({ one }) => ({
  provider: one(gitProviders, {
    fields: [gitProviderSetupStates.providerId],
    references: [gitProviders.id]
  }),
  team: one(teams, {
    fields: [gitProviderSetupStates.teamId],
    references: [teams.id]
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
