import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { teams } from "./teams";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 256 }),
    username: varchar("username", { length: 50 }),
    emailVerified: boolean("email_verified").default(false).notNull(),
    hasAvatar: boolean("has_avatar").default(false).notNull(),
    image: text("image"),
    role: varchar("role", { length: 20 }).default("viewer").notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    defaultTeamId: varchar("default_team_id", { length: 32 }),
    tokensInvalidBefore: timestamp("tokens_invalid_before"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_username_idx").on(table.username),
    index("users_created_at_idx").on(table.createdAt)
  ]
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(), // github | google | password
    providerUserId: varchar("provider_user_id", { length: 100 }),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at"),
    passwordHash: varchar("password_hash", { length: 255 }),
    providerMetadata: text("provider_metadata"), // JSON
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("user_identities_user_id_idx").on(table.userId),
    index("user_identities_provider_idx").on(table.provider),
    uniqueIndex("user_identities_provider_user_idx").on(table.provider, table.providerUserId)
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  defaultTeam: one(teams, {
    fields: [users.defaultTeamId],
    references: [teams.id]
  }),
  identities: many(userIdentities)
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id]
  })
}));
