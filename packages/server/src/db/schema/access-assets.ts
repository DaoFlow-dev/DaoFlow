import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { teams } from "./teams";
import { users } from "./users";

export const managedSshKeys = pgTable(
  "managed_ssh_keys",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    username: varchar("username", { length: 80 }),
    fingerprint: varchar("fingerprint", { length: 120 }).notNull(),
    keyType: varchar("key_type", { length: 40 }).notNull(),
    publicKey: text("public_key"),
    privateKeyEncrypted: text("private_key_encrypted").notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    rotatedAt: timestamp("rotated_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("managed_ssh_keys_team_name_idx").on(table.teamId, table.name),
    uniqueIndex("managed_ssh_keys_team_fingerprint_idx").on(table.teamId, table.fingerprint),
    index("managed_ssh_keys_team_idx").on(table.teamId),
    index("managed_ssh_keys_status_idx").on(table.status)
  ]
);

export const certificateAssets = pgTable(
  "certificate_assets",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    certificatePemEncrypted: text("certificate_pem_encrypted").notNull(),
    privateKeyEncrypted: text("private_key_encrypted"),
    caChainEncrypted: text("ca_chain_encrypted"),
    fingerprint: varchar("fingerprint", { length: 120 }).notNull(),
    subject: text("subject"),
    issuer: text("issuer"),
    expiresAt: timestamp("expires_at"),
    domains: jsonb("domains").default([]).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("certificate_assets_team_name_idx").on(table.teamId, table.name),
    uniqueIndex("certificate_assets_team_fingerprint_idx").on(table.teamId, table.fingerprint),
    index("certificate_assets_team_idx").on(table.teamId),
    index("certificate_assets_status_idx").on(table.status),
    index("certificate_assets_expires_at_idx").on(table.expiresAt)
  ]
);

export const managedSshKeysRelations = relations(managedSshKeys, ({ one }) => ({
  team: one(teams, {
    fields: [managedSshKeys.teamId],
    references: [teams.id]
  }),
  createdByUser: one(users, {
    fields: [managedSshKeys.createdByUserId],
    references: [users.id]
  })
}));

export const certificateAssetsRelations = relations(certificateAssets, ({ one }) => ({
  team: one(teams, {
    fields: [certificateAssets.teamId],
    references: [teams.id]
  }),
  createdByUser: one(users, {
    fields: [certificateAssets.createdByUserId],
    references: [users.id]
  })
}));
