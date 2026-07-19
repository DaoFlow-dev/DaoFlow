import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { servers } from "./servers";
import { users } from "./users";
import { backupDestinations } from "./destinations";
import { externalBackupArtifacts } from "./external-backup-artifacts";

export interface BackupRunLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
}

export type BackupRestoreMode = "restore" | "verification";

export interface BackupVerificationCheckResult {
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface BackupVerificationResult {
  version: 1;
  success: boolean;
  checksum: string;
  sourceEngineVersion: string;
  verifierEngineVersion: string;
  durationMs: number;
  checks: {
    input: BackupVerificationCheckResult;
    verifierImage: BackupVerificationCheckResult;
    archive: BackupVerificationCheckResult;
    checksum: BackupVerificationCheckResult;
    container: BackupVerificationCheckResult;
    readiness: BackupVerificationCheckResult;
    restore: BackupVerificationCheckResult;
    catalog: BackupVerificationCheckResult;
  };
  objectCounts: {
    schemas: number;
    tables: number;
    indexes: number;
    functions: number;
  };
  cleanup: {
    attempted: boolean;
    containerRemoved: boolean;
    workspaceRemoved: boolean;
    error?: string;
  };
  completedAt: string;
  error?: string;
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
    artifactFormat: varchar("artifact_format", { length: 40 }),
    databaseEngineVersion: varchar("database_engine_version", { length: 64 }),
    databaseImageReference: text("database_image_reference"),
    // Remote-presence checks are weaker than a full restore verification.
    artifactCheckedAt: timestamp("artifact_checked_at"),
    // Set only after a successful isolated test restore.
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
    backupRunId: varchar("backup_run_id", { length: 32 }).references(() => backupRuns.id),
    externalArtifactId: varchar("external_artifact_id", { length: 32 }).references(
      () => externalBackupArtifacts.id,
      { onDelete: "restrict" }
    ),
    targetVolumeId: varchar("target_volume_id", { length: 32 }).references(() => volumes.id, {
      onDelete: "restrict"
    }),
    mode: varchar("mode", { length: 20 }).default("restore").notNull(),
    status: varchar("status", { length: 20 }).default("queued").notNull(),
    targetPath: text("target_path"),
    verificationResult: jsonb("verification_result").$type<BackupVerificationResult | null>(),
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
    index("backup_restores_external_artifact_id_idx").on(table.externalArtifactId),
    index("backup_restores_target_volume_id_idx").on(table.targetVolumeId),
    index("backup_restores_created_at_idx").on(table.createdAt),
    check("backup_restores_mode_check", sql`${table.mode} IN ('restore', 'verification')`),
    check(
      "backup_restores_verification_result_mode_check",
      sql`${table.verificationResult} IS NULL OR ${table.mode} = 'verification'`
    ),
    check(
      "backup_restores_source_xor_check",
      sql`(
        (${table.backupRunId} IS NOT NULL AND ${table.externalArtifactId} IS NULL)
        OR (${table.backupRunId} IS NULL AND ${table.externalArtifactId} IS NOT NULL)
      )`
    ),
    check(
      "backup_restores_external_target_mode_check",
      sql`(
        (${table.backupRunId} IS NOT NULL AND ${table.targetVolumeId} IS NULL)
        OR (
          ${table.externalArtifactId} IS NOT NULL
          AND (
            (${table.mode} = 'verification' AND ${table.targetVolumeId} IS NULL)
            OR (${table.mode} = 'restore' AND ${table.targetVolumeId} IS NOT NULL)
          )
        )
      )`
    )
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
  externalArtifact: one(externalBackupArtifacts, {
    fields: [backupRestores.externalArtifactId],
    references: [externalBackupArtifacts.id]
  }),
  targetVolume: one(volumes, {
    fields: [backupRestores.targetVolumeId],
    references: [volumes.id]
  }),
  triggeredByUser: one(users, {
    fields: [backupRestores.triggeredByUserId],
    references: [users.id]
  })
}));
