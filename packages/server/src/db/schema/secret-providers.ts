import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { teams } from "./teams";
import { users } from "./users";

/**
 * External secret providers (e.g. 1Password service accounts).
 * Stores encrypted connection config per team.
 */
export const secretProviders = pgTable(
  "secret_providers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 20 }).notNull(), // "1password"
    /** Encrypted JSON: { serviceAccountToken: "..." } */
    configEncrypted: text("config_encrypted").notNull(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).default("active").notNull(), // active | disconnected
    lastTestedAt: timestamp("last_tested_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    metadata: jsonb("metadata").default({}).notNull(), // vaults accessible, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("secret_providers_team_id_idx").on(table.teamId),
    index("secret_providers_type_idx").on(table.type)
  ]
);

export const secretProvidersRelations = relations(secretProviders, ({ one }) => ({
  team: one(teams, {
    fields: [secretProviders.teamId],
    references: [teams.id]
  }),
  createdByUser: one(users, {
    fields: [secretProviders.createdByUserId],
    references: [users.id]
  })
}));
