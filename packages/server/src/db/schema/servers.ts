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
import { users } from "./users";

export const servers = pgTable(
  "servers",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    host: varchar("host", { length: 120 }).notNull(),
    region: varchar("region", { length: 60 }),
    sshPort: integer("ssh_port").default(22).notNull(),
    sshKeyId: varchar("ssh_key_id", { length: 64 }),
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
    index("servers_region_idx").on(table.region),
    index("servers_created_at_idx").on(table.createdAt)
  ]
);

export const serversRelations = relations(servers, ({ one }) => ({
  registeredByUser: one(users, {
    fields: [servers.registeredByUserId],
    references: [users.id]
  })
}));
