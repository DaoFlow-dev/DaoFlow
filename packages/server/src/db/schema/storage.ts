import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { servers } from "./servers";
import { users } from "./users";
import { backupDestinations } from "./destinations";

export interface BackupRunLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
}

export const volumes = pgTable(
  "volumes",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id),
    mountPath: text("mount_path").notNull(),
    sizeBytes: text("size_bytes"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("volumes_server_id_idx").on(table.serverId),
    index("volumes_name_idx").on(table.name)
  ]
);

export const backupPolicies = pgTable(
  "backup_policies",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    volumeId: varchar("volume_id", { length: 32 })
      .notNull()
      .references(() => volumes.id),
    // "volume" = raw volume tar, "database" = logical dump (pg_dump/mysqldump/mongodump)
    backupType: varchar("backup_type", { length: 20 }).default("volume").notNull(),
    // Optional: database engine hint when backupType="database" (postgres, mysql, mariadb, mongo)
    databaseEngine: varchar("database_engine", { length: 20 }),
    // If true, stop the container before backing up for data consistency
    turnOff: integer("turn_off").default(0).notNull(), // 0=false, 1=true (boolean via int)
    schedule: varchar("schedule", { length: 60 }), // cron expression
    retentionDays: integer("retention_days").default(30).notNull(),
    // ── GFS Retention (Grandfather-Father-Son) ──
    retentionDaily: integer("retention_daily").default(7),
    retentionWeekly: integer("retention_weekly").default(4),
    retentionMonthly: integer("retention_monthly").default(12),
    maxBackups: integer("max_backups").default(100), // hard cap safety net
    storageTarget: text("storage_target"), // s3://bucket/prefix (legacy, use destinationId)
    destinationId: varchar("destination_id", { length: 32 }).references(
      () => backupDestinations.id,
      { onDelete: "set null" }
    ),
    temporalWorkflowId: varchar("temporal_workflow_id", { length: 100 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [index("backup_policies_volume_id_idx").on(table.volumeId)]
);

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    policyId: varchar("policy_id", { length: 32 })
      .notNull()
      .references(() => backupPolicies.id),
    status: varchar("status", { length: 20 }).default("queued").notNull(), // queued | running | succeeded | failed
    artifactPath: text("artifact_path"),
    sizeBytes: text("size_bytes"),
    // SHA-256 checksum of the backup artifact for integrity verification
    checksum: varchar("checksum", { length: 128 }),
    // When this backup was last verified via test-restore
    verifiedAt: timestamp("verified_at"),
    triggeredByUserId: text("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    logEntries: jsonb("log_entries").$type<BackupRunLogEntry[] | null>(),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("backup_runs_policy_id_idx").on(table.policyId),
    index("backup_runs_status_idx").on(table.status),
    index("backup_runs_created_at_idx").on(table.createdAt)
  ]
);

export const backupRestores = pgTable(
  "backup_restores",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    backupRunId: varchar("backup_run_id", { length: 32 })
      .notNull()
      .references(() => backupRuns.id),
    status: varchar("status", { length: 20 }).default("queued").notNull(),
    targetPath: text("target_path"),
    triggeredByUserId: text("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("backup_restores_backup_run_id_idx").on(table.backupRunId),
    index("backup_restores_created_at_idx").on(table.createdAt)
  ]
);

export const volumesRelations = relations(volumes, ({ one, many }) => ({
  server: one(servers, {
    fields: [volumes.serverId],
    references: [servers.id]
  }),
  backupPolicies: many(backupPolicies)
}));

export const backupPoliciesRelations = relations(backupPolicies, ({ one, many }) => ({
  volume: one(volumes, {
    fields: [backupPolicies.volumeId],
    references: [volumes.id]
  }),
  destination: one(backupDestinations, {
    fields: [backupPolicies.destinationId],
    references: [backupDestinations.id]
  }),
  runs: many(backupRuns)
}));

export const backupRunsRelations = relations(backupRuns, ({ one, many }) => ({
  policy: one(backupPolicies, {
    fields: [backupRuns.policyId],
    references: [backupPolicies.id]
  }),
  triggeredByUser: one(users, {
    fields: [backupRuns.triggeredByUserId],
    references: [users.id]
  }),
  restores: many(backupRestores)
}));

export const backupRestoresRelations = relations(backupRestores, ({ one }) => ({
  backupRun: one(backupRuns, {
    fields: [backupRestores.backupRunId],
    references: [backupRuns.id]
  }),
  triggeredByUser: one(users, {
    fields: [backupRestores.triggeredByUserId],
    references: [users.id]
  })
}));
