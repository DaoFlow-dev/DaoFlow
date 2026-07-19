import {
  boolean,
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
import { environments, projects } from "./projects";
import { services } from "./services";
import { users } from "./users";

export const serviceSchedules = pgTable(
  "service_schedules",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    projectId: varchar("project_id", { length: 32 })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environmentId: varchar("environment_id", { length: 32 })
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    serviceId: varchar("service_id", { length: 32 })
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    command: text("command").notNull(),
    cronExpression: varchar("cron_expression", { length: 120 }).notNull(),
    timezone: varchar("timezone", { length: 80 }).default("UTC").notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    retentionCount: integer("retention_count").default(20).notNull(),
    notifyOnFailure: boolean("notify_on_failure").default(true).notNull(),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("service_schedules_project_idx").on(table.projectId),
    index("service_schedules_environment_idx").on(table.environmentId),
    index("service_schedules_service_idx").on(table.serviceId),
    index("service_schedules_status_idx").on(table.status),
    index("service_schedules_next_run_idx").on(table.nextRunAt)
  ]
);

export const serviceScheduleRuns = pgTable(
  "service_schedule_runs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    scheduleId: varchar("schedule_id", { length: 32 })
      .notNull()
      .references(() => serviceSchedules.id, { onDelete: "cascade" }),
    serviceId: varchar("service_id", { length: 32 })
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    triggerKind: varchar("trigger_kind", { length: 20 }).notNull(),
    scheduledFor: timestamp("scheduled_for"),
    leaseGeneration: integer("lease_generation"),
    leaseHolderInstanceId: varchar("lease_holder_instance_id", { length: 32 }),
    runnerInstanceId: varchar("runner_instance_id", { length: 32 }),
    status: varchar("status", { length: 20 }).default("queued").notNull(),
    command: text("command").notNull(),
    logs: text("logs").default("").notNull(),
    result: jsonb("result").default({}).notNull(),
    error: text("error"),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    requestedByEmail: varchar("requested_by_email", { length: 320 }),
    requestedByRole: varchar("requested_by_role", { length: 20 }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("service_schedule_runs_schedule_idx").on(table.scheduleId),
    index("service_schedule_runs_service_idx").on(table.serviceId),
    index("service_schedule_runs_status_idx").on(table.status),
    index("service_schedule_runs_created_idx").on(table.createdAt),
    uniqueIndex("service_schedule_runs_schedule_scheduled_for_unique").on(
      table.scheduleId,
      table.scheduledFor
    )
  ]
);

export const serviceScheduleMonitorLeases = pgTable(
  "service_schedule_monitor_leases",
  {
    key: varchar("lease_key", { length: 32 }).primaryKey(),
    holderInstanceId: varchar("holder_instance_id", { length: 32 }).notNull(),
    generation: integer("generation").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (table) => [index("service_schedule_monitor_leases_expires_idx").on(table.expiresAt)]
);

export const serviceSchedulesRelations = relations(serviceSchedules, ({ one, many }) => ({
  project: one(projects, {
    fields: [serviceSchedules.projectId],
    references: [projects.id]
  }),
  environment: one(environments, {
    fields: [serviceSchedules.environmentId],
    references: [environments.id]
  }),
  service: one(services, {
    fields: [serviceSchedules.serviceId],
    references: [services.id]
  }),
  runs: many(serviceScheduleRuns)
}));

export const serviceScheduleRunsRelations = relations(serviceScheduleRuns, ({ one }) => ({
  schedule: one(serviceSchedules, {
    fields: [serviceScheduleRuns.scheduleId],
    references: [serviceSchedules.id]
  }),
  service: one(services, {
    fields: [serviceScheduleRuns.serviceId],
    references: [services.id]
  })
}));
