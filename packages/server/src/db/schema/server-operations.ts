import {
  boolean,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { servers } from "./servers";
import { users } from "./users";

export const serverOperations = pgTable(
  "server_operations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).default("queued").notNull(),
    dryRun: boolean("dry_run").default(false).notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    requestedByEmail: varchar("requested_by_email", { length: 320 }),
    requestedByRole: varchar("requested_by_role", { length: 20 }),
    permissionScope: varchar("permission_scope", { length: 60 }),
    summary: text("summary"),
    result: jsonb("result").default({}).notNull(),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("server_operations_server_idx").on(table.serverId),
    index("server_operations_kind_idx").on(table.kind),
    index("server_operations_status_idx").on(table.status),
    index("server_operations_created_at_idx").on(table.createdAt)
  ]
);

export const serverOperationLogs = pgTable(
  "server_operation_logs",
  {
    id: serial("id").primaryKey(),
    operationId: varchar("operation_id", { length: 32 })
      .notNull()
      .references(() => serverOperations.id, { onDelete: "cascade" }),
    stream: varchar("stream", { length: 20 }).default("info").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("server_operation_logs_operation_idx").on(table.operationId),
    index("server_operation_logs_created_at_idx").on(table.createdAt)
  ]
);

export const serverOperationsRelations = relations(serverOperations, ({ one, many }) => ({
  server: one(servers, {
    fields: [serverOperations.serverId],
    references: [servers.id]
  }),
  requestedByUser: one(users, {
    fields: [serverOperations.requestedByUserId],
    references: [users.id]
  }),
  logs: many(serverOperationLogs)
}));

export const serverOperationLogsRelations = relations(serverOperationLogs, ({ one }) => ({
  operation: one(serverOperations, {
    fields: [serverOperationLogs.operationId],
    references: [serverOperations.id]
  })
}));
