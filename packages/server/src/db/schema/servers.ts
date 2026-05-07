import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { managedSshKeys } from "./access-assets";
import { teams } from "./teams";
import { users } from "./users";

export const servers = pgTable(
  "servers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    host: varchar("host", { length: 120 }).notNull(),
    region: varchar("region", { length: 60 }),
    teamId: varchar("team_id", { length: 32 }).references(() => teams.id, {
      onDelete: "set null"
    }),
    sshPort: integer("ssh_port").default(22).notNull(),
    sshUser: varchar("ssh_user", { length: 80 }),
    sshKeyId: varchar("ssh_key_id", { length: 32 }).references(() => managedSshKeys.id, {
      onDelete: "set null"
    }),
    sshPrivateKeyEncrypted: text("ssh_private_key_encrypted"),
    kind: varchar("kind", { length: 30 }).default("docker-engine").notNull(),
    status: varchar("status", { length: 30 }).default("pending verification").notNull(),
    dockerVersion: varchar("docker_version", { length: 40 }),
    composeVersion: varchar("compose_version", { length: 40 }),
    metadata: jsonb("metadata").default({}).notNull(),
    registeredByUserId: text("registered_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    lastCheckedAt: timestamp("last_checked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("servers_name_idx").on(table.name),
    uniqueIndex("servers_host_idx").on(table.host),
    index("servers_team_id_idx").on(table.teamId),
    index("servers_ssh_key_id_idx").on(table.sshKeyId),
    index("servers_region_idx").on(table.region),
    index("servers_created_at_idx").on(table.createdAt)
  ]
);

export const serversRelations = relations(servers, ({ one }) => ({
  team: one(teams, {
    fields: [servers.teamId],
    references: [teams.id]
  }),
  registeredByUser: one(users, {
    fields: [servers.registeredByUserId],
    references: [users.id]
  }),
  managedSshKey: one(managedSshKeys, {
    fields: [servers.sshKeyId],
    references: [managedSshKeys.id]
  })
}));
