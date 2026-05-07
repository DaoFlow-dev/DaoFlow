import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const requestAccessLogs = pgTable(
  "request_access_logs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    requestId: varchar("request_id", { length: 80 }).notNull(),
    method: varchar("method", { length: 12 }).notNull(),
    path: varchar("path", { length: 255 }).notNull(),
    category: varchar("category", { length: 30 }).default("api").notNull(),
    statusCode: integer("status_code").notNull(),
    outcome: varchar("outcome", { length: 30 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    authMethod: varchar("auth_method", { length: 20 }),
    actorType: varchar("actor_type", { length: 20 }),
    actorId: varchar("actor_id", { length: 320 }),
    actorEmail: varchar("actor_email", { length: 320 }),
    actorRole: varchar("actor_role", { length: 20 }),
    tokenId: varchar("token_id", { length: 32 }),
    tokenName: varchar("token_name", { length: 80 }),
    tokenPrefix: varchar("token_prefix", { length: 12 }),
    sourceIp: varchar("source_ip", { length: 80 }),
    userAgent: varchar("user_agent", { length: 255 }),
    errorCategory: varchar("error_category", { length: 80 }),
    requiredScopes: text("required_scopes"),
    grantedScopes: text("granted_scopes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("request_access_logs_request_id_idx").on(table.requestId),
    index("request_access_logs_created_at_idx").on(table.createdAt),
    index("request_access_logs_path_idx").on(table.path),
    index("request_access_logs_status_idx").on(table.statusCode),
    index("request_access_logs_category_idx").on(table.category),
    index("request_access_logs_outcome_idx").on(table.outcome),
    index("request_access_logs_token_idx").on(table.tokenId)
  ]
);
