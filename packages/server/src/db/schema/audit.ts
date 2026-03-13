import { index, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: serial("id").primaryKey(),
    actorType: varchar("actor_type", { length: 20 }).notNull(), // user | agent | system | token
    actorId: varchar("actor_id", { length: 320 }).notNull(),
    actorEmail: varchar("actor_email", { length: 320 }),
    actorRole: varchar("actor_role", { length: 20 }),
    organizationId: varchar("organization_id", { length: 32 }),
    targetResource: varchar("target_resource", { length: 200 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    inputSummary: text("input_summary"),
    permissionScope: varchar("permission_scope", { length: 60 }),
    outcome: varchar("outcome", { length: 20 }).default("success").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("audit_entries_actor_id_idx").on(table.actorId),
    index("audit_entries_action_idx").on(table.action),
    index("audit_entries_target_resource_idx").on(table.targetResource),
    index("audit_entries_created_at_idx").on(table.createdAt)
  ]
);

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 60 }).notNull(), // deployment.started | backup.completed | etc
    resourceType: varchar("resource_type", { length: 40 }).notNull(),
    resourceId: varchar("resource_id", { length: 32 }).notNull(),
    summary: text("summary").notNull(),
    detail: text("detail"),
    severity: varchar("severity", { length: 10 }).default("info").notNull(), // info | warning | error | critical
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("events_kind_idx").on(table.kind),
    index("events_resource_idx").on(table.resourceType, table.resourceId),
    index("events_created_at_idx").on(table.createdAt),
    index("events_severity_idx").on(table.severity)
  ]
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    actionType: varchar("action_type", { length: 40 }).notNull(), // compose-release | backup-restore | deployment
    targetResource: varchar("target_resource", { length: 200 }).notNull(),
    reason: text("reason"),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | approved | rejected
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    requestedByEmail: varchar("requested_by_email", { length: 320 }),
    requestedByRole: varchar("requested_by_role", { length: 20 }),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    resolvedByEmail: varchar("resolved_by_email", { length: 320 }),
    inputSummary: jsonb("input_summary"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at")
  },
  (table) => [
    index("approval_requests_status_idx").on(table.status),
    index("approval_requests_action_type_idx").on(table.actionType),
    index("approval_requests_created_at_idx").on(table.createdAt)
  ]
);

export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  requestedByUser: one(users, {
    fields: [approvalRequests.requestedByUserId],
    references: [users.id]
  }),
  resolvedByUser: one(users, {
    fields: [approvalRequests.resolvedByUserId],
    references: [users.id]
  })
}));
