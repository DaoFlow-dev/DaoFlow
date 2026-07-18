import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { servers } from "./servers";
import { teams } from "./teams";
import { users } from "./users";

export const sshHostIdentities = pgTable(
  "ssh_host_identities",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    algorithm: varchar("algorithm", { length: 80 }).notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).default("observed").notNull(),
    observedAt: timestamp("observed_at").defaultNow().notNull(),
    lastObservedAt: timestamp("last_observed_at").defaultNow().notNull(),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    supersededAt: timestamp("superseded_at"),
    supersededByUserId: text("superseded_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("ssh_host_identities_server_key_idx").on(
      table.serverId,
      table.algorithm,
      table.fingerprint
    ),
    uniqueIndex("ssh_host_identities_active_server_idx")
      .on(table.serverId)
      .where(sql`${table.status} = 'approved'`),
    index("ssh_host_identities_team_idx").on(table.teamId),
    index("ssh_host_identities_server_idx").on(table.serverId),
    index("ssh_host_identities_status_idx").on(table.status)
  ]
);

export const sshHostIdentitiesRelations = relations(sshHostIdentities, ({ one }) => ({
  team: one(teams, {
    fields: [sshHostIdentities.teamId],
    references: [teams.id]
  }),
  server: one(servers, {
    fields: [sshHostIdentities.serverId],
    references: [servers.id]
  }),
  approvedByUser: one(users, {
    fields: [sshHostIdentities.approvedByUserId],
    references: [users.id]
  }),
  supersededByUser: one(users, {
    fields: [sshHostIdentities.supersededByUserId],
    references: [users.id]
  })
}));
