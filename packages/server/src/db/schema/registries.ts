import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const containerRegistries = pgTable(
  "container_registries",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    registryHost: varchar("registry_host", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    passwordEncrypted: text("password_encrypted").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("container_registries_name_idx").on(table.name),
    uniqueIndex("container_registries_host_idx").on(table.registryHost),
    index("container_registries_created_at_idx").on(table.createdAt)
  ]
);
