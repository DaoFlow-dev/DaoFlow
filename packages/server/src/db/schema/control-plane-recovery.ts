import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { backupDestinations } from "./destinations";
import { teams } from "./teams";
import { users } from "./users";

export type ControlPlaneRecoveryCheckStatus = "passed" | "failed" | "skipped";

export interface ControlPlaneRecoveryCheck {
  status: ControlPlaneRecoveryCheckStatus;
  detail: string;
}

export interface ControlPlaneRecoveryMigrationEntry {
  hash: string;
  createdAt: number;
}

export interface ControlPlaneRecoveryManifest {
  formatVersion: 1;
  bundleId: string;
  appVersion: string;
  schemaVersion: string;
  createdAt: string;
  database: {
    engine: "postgres";
    version: string;
    dumpFormat: "postgres-custom";
    sha256: string;
  };
  migrations: {
    count: number;
    latestHash: string | null;
    applied: ControlPlaneRecoveryMigrationEntry[];
  };
  compatibility: {
    minimumAppVersion: string;
    maximumAppVersionExclusive: string;
  };
  requiredExternalSecrets: string[];
  recoveryKey: {
    fingerprint: string;
    rotatedAt: string | null;
  };
  sanitization: {
    clearedFields: string[];
  };
  objects: {
    bundlePath: string;
    manifestPath: string;
    latestManifestPath: string;
  };
}

export interface ControlPlaneRecoveryVerificationResult {
  version: 1;
  success: boolean;
  databaseSha256: string;
  bundleSha256: string;
  sourcePostgresVersion: string;
  verifierImage: string;
  durationMs: number;
  checks: {
    archive: ControlPlaneRecoveryCheck;
    restore: ControlPlaneRecoveryCheck;
    migrations: ControlPlaneRecoveryCheck;
    ownership: ControlPlaneRecoveryCheck;
    secretDecryptability: ControlPlaneRecoveryCheck;
    remoteRoundTrip: ControlPlaneRecoveryCheck;
  };
  objectCounts: {
    teams: number;
    users: number;
    projects: number;
    servers: number;
    auditEntries: number;
    backupRuns: number;
  };
  completedAt: string;
  error?: string;
}

export const controlPlaneRecoveryBundles = pgTable(
  "control_plane_recovery_bundles",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    ownerTeamId: varchar("owner_team_id", { length: 32 })
      .notNull()
      .references(() => teams.id),
    destinationId: varchar("destination_id", { length: 32 })
      .notNull()
      .references(() => backupDestinations.id),
    status: varchar("status", { length: 20 }).default("queued").notNull(),
    formatVersion: integer("format_version").default(1).notNull(),
    appVersion: varchar("app_version", { length: 32 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 128 }).notNull(),
    keyFingerprint: varchar("key_fingerprint", { length: 64 }).notNull(),
    keyRotatedAt: timestamp("key_rotated_at"),
    objectPrefix: text("object_prefix").notNull(),
    bundleObjectPath: text("bundle_object_path").notNull(),
    manifestObjectPath: text("manifest_object_path").notNull(),
    latestManifestObjectPath: text("latest_manifest_object_path").notNull(),
    bundleChecksum: varchar("bundle_checksum", { length: 64 }),
    databaseChecksum: varchar("database_checksum", { length: 64 }),
    sizeBytes: text("size_bytes"),
    manifest: jsonb("manifest").$type<ControlPlaneRecoveryManifest | null>(),
    verificationResult: jsonb(
      "verification_result"
    ).$type<ControlPlaneRecoveryVerificationResult | null>(),
    idempotencyKey: varchar("idempotency_key", { length: 71 }),
    temporalWorkflowId: text("temporal_workflow_id"),
    temporalRunId: text("temporal_run_id"),
    dispatchedAt: timestamp("dispatched_at"),
    error: text("error"),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("control_plane_recovery_team_idx").on(table.ownerTeamId),
    index("control_plane_recovery_destination_idx").on(table.destinationId),
    index("control_plane_recovery_status_idx").on(table.status),
    index("control_plane_recovery_created_at_idx").on(table.createdAt),
    uniqueIndex("control_plane_recovery_request_idempotency_idx").on(
      table.ownerTeamId,
      table.requestedByUserId,
      table.idempotencyKey
    ),
    check(
      "control_plane_recovery_status_check",
      sql`${table.status} IN ('queued', 'running', 'verified', 'failed')`
    ),
    check("control_plane_recovery_format_version_check", sql`${table.formatVersion} = 1`)
  ]
);

export const controlPlaneRecoveryBundlesRelations = relations(
  controlPlaneRecoveryBundles,
  ({ one }) => ({
    ownerTeam: one(teams, {
      fields: [controlPlaneRecoveryBundles.ownerTeamId],
      references: [teams.id]
    }),
    destination: one(backupDestinations, {
      fields: [controlPlaneRecoveryBundles.destinationId],
      references: [backupDestinations.id]
    }),
    requestedByUser: one(users, {
      fields: [controlPlaneRecoveryBundles.requestedByUserId],
      references: [users.id]
    })
  })
);
