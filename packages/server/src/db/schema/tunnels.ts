import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { teams } from "./teams";

/**
 * Cloudflare Tunnel configuration.
 *
 * Stores tunnel credentials and routing rules so DaoFlow can
 * automatically expose services through Cloudflare's network
 * without opening inbound firewall ports.
 */
export const tunnels = pgTable(
  "tunnels",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    tunnelId: varchar("tunnel_id", { length: 80 }),
    credentialsEncrypted: text("credentials_encrypted"),
    domain: varchar("domain", { length: 255 }),
    status: varchar("status", { length: 20 }).default("inactive").notNull(),
    config: jsonb("config").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("tunnels_name_team_idx").on(table.name, table.teamId),
    uniqueIndex("tunnels_tunnel_id_idx").on(table.tunnelId)
  ]
);

/**
 * Tunnel route entries — maps a hostname to a local service.
 */
export const tunnelRoutes = pgTable(
  "tunnel_routes",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    tunnelId: varchar("tunnel_id", { length: 32 })
      .notNull()
      .references(() => tunnels.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 255 }).notNull(),
    service: varchar("service", { length: 255 }).notNull(),
    path: varchar("path", { length: 255 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("tunnel_routes_tunnel_id_idx").on(table.tunnelId),
    uniqueIndex("tunnel_routes_hostname_idx").on(table.hostname)
  ]
);

export const tunnelsRelations = relations(tunnels, ({ one, many }) => ({
  team: one(teams, {
    fields: [tunnels.teamId],
    references: [teams.id]
  }),
  routes: many(tunnelRoutes)
}));

export const tunnelRoutesRelations = relations(tunnelRoutes, ({ one }) => ({
  tunnel: one(tunnels, {
    fields: [tunnelRoutes.tunnelId],
    references: [tunnels.id]
  })
}));
