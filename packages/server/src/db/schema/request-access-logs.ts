import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { apiTokens } from "./tokens";

export const requestAccessLogs = pgTable(
  "request_access_logs",
  {
    id: serial("id").primaryKey(),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 240 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms").notNull(),
    outcome: varchar("outcome", { length: 20 }).notNull(),
    errorCategory: varchar("error_category", { length: 60 }),
    authMethod: varchar("auth_method", { length: 20 }),
    actorType: varchar("actor_type", { length: 20 }),
    actorId: varchar("actor_id", { length: 320 }),
    actorEmail: varchar("actor_email", { length: 320 }),
    actorRole: varchar("actor_role", { length: 20 }),
    tokenId: varchar("token_id", { length: 32 }).references(() => apiTokens.id, {
      onDelete: "set null"
    }),
    tokenPrefix: varchar("token_prefix", { length: 12 }),
    sourceIp: varchar("source_ip", { length: 80 }),
    userAgent: varchar("user_agent", { length: 240 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("request_access_logs_request_id_idx").on(table.requestId),
    index("request_access_logs_category_idx").on(table.category),
    index("request_access_logs_status_idx").on(table.statusCode),
    index("request_access_logs_token_id_idx").on(table.tokenId),
    index("request_access_logs_actor_id_idx").on(table.actorId),
    index("request_access_logs_created_at_idx").on(table.createdAt)
  ]
);
