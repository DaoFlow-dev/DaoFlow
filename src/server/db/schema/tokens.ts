import {
  integer,
  index,
  pgTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(), // first 8 chars for identification
    principalType: varchar("principal_type", { length: 20 }).notNull(), // user | service | agent
    principalId: varchar("principal_id", { length: 320 }).notNull(),
    scopes: text("scopes").notNull(), // comma-separated: read,logs:read,deploy:start
    status: varchar("status", { length: 20 }).default("active").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at")
  },
  (table) => [
    index("api_tokens_principal_idx").on(
      table.principalType,
      table.principalId
    ),
    index("api_tokens_token_hash_idx").on(table.tokenHash),
    index("api_tokens_status_idx").on(table.status),
    index("api_tokens_created_at_idx").on(table.createdAt)
  ]
);

export const principals = pgTable(
  "principals",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    type: varchar("type", { length: 20 }).notNull(), // user | service | agent
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    linkedUserId: integer("linked_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    defaultScopes: text("default_scopes"), // comma-separated default scopes
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("principals_type_idx").on(table.type),
    index("principals_name_idx").on(table.name)
  ]
);

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  createdByUser: one(users, {
    fields: [apiTokens.createdByUserId],
    references: [users.id]
  })
}));

export const principalsRelations = relations(principals, ({ one }) => ({
  linkedUser: one(users, {
    fields: [principals.linkedUserId],
    references: [users.id]
  })
}));
