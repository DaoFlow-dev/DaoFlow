import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const containerRegistries = pgTable(
  "container_registries",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    registryHost: varchar("registry_host", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("container_registries_name_team_idx").on(table.name, table.teamId),
    uniqueIndex("container_registries_host_team_idx").on(table.registryHost, table.teamId),
    index("container_registries_team_id_idx").on(table.teamId),
    index("container_registries_created_at_idx").on(table.createdAt)
  ]
);
