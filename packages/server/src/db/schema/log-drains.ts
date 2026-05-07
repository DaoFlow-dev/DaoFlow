import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const logDrains = pgTable(
  "log_drains",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    destinationType: varchar("destination_type", { length: 40 }).notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    headersEncrypted: text("headers_encrypted"),
    serviceFilter: varchar("service_filter", { length: 100 }),
    environmentFilter: varchar("environment_filter", { length: 100 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    lastDeliveredAt: timestamp("last_delivered_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("log_drains_team_id_idx").on(table.teamId),
    index("log_drains_destination_type_idx").on(table.destinationType),
    index("log_drains_status_idx").on(table.status)
  ]
);

export const logDrainDeliveries = pgTable(
  "log_drain_deliveries",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    drainId: varchar("drain_id", { length: 32 })
      .notNull()
      .references(() => logDrains.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    httpStatus: varchar("http_status", { length: 5 }),
    payload: jsonb("payload").default({}).notNull(),
    responseBody: text("response_body"),
    error: text("error"),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at")
  },
  (table) => [
    index("log_drain_deliveries_drain_id_idx").on(table.drainId),
    index("log_drain_deliveries_status_idx").on(table.status),
    index("log_drain_deliveries_attempted_at_idx").on(table.attemptedAt)
  ]
);
