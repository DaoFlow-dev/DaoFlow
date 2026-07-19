import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { backupDestinations } from "./destinations";
import { teams } from "./teams";
import { users } from "./users";

export type ExternalBackupArtifactStatus =
  "registering" | "registered" | "verifying" | "verified" | "failed";

/**
 * Imported PostgreSQL custom-format artifacts are intentionally separate from
 * DaoFlow-created backup runs. They retain their own immutable object identity
 * and can never cause a synthetic policy or backup run to be created.
 */
export const externalBackupArtifacts = pgTable(
  "external_backup_artifacts",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    destinationId: varchar("destination_id", { length: 32 })
      .notNull()
      .references(() => backupDestinations.id, { onDelete: "restrict" }),
    objectKey: text("object_key").notNull(),
    // Version IDs are not available on all S3-compatible services. An ETag is
    // retained as the fallback immutable-read condition when it is absent.
    objectVersion: text("object_version"),
    objectEtag: varchar("object_etag", { length: 512 }),
    sizeBytes: text("size_bytes").notNull(),
    contentType: varchar("content_type", { length: 255 }),
    lastModified: timestamp("last_modified"),
    sha256: varchar("sha256", { length: 64 }),
    archiveFormat: varchar("archive_format", { length: 32 }).default("postgres-custom").notNull(),
    listingEvidence: text("listing_evidence"),
    sourcePostgresVersion: varchar("source_postgres_version", { length: 64 }).notNull(),
    verifierImage: text("verifier_image"),
    status: varchar("status", { length: 20 }).default("registering").notNull(),
    registerError: text("register_error"),
    registeredByUserId: varchar("registered_by_user_id", { length: 32 }).references(
      () => users.id,
      { onDelete: "set null" }
    ),
    registeredAt: timestamp("registered_at"),
    verifiedAt: timestamp("verified_at"),
    // A compact, sanitized result from the latest isolated test restore. The
    // full per-attempt result remains attached to backup_restores.
    latestVerification: jsonb("latest_verification"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("external_backup_artifacts_team_created_idx").on(table.teamId, table.createdAt),
    index("external_backup_artifacts_destination_created_idx").on(
      table.destinationId,
      table.createdAt
    ),
    index("external_backup_artifacts_status_idx").on(table.status),
    uniqueIndex("external_backup_artifacts_version_identity_uq")
      .on(table.destinationId, table.objectKey, table.objectVersion)
      .where(sql`${table.objectVersion} IS NOT NULL`),
    uniqueIndex("external_backup_artifacts_etag_identity_uq")
      .on(table.destinationId, table.objectKey, table.objectEtag)
      .where(sql`${table.objectVersion} IS NULL`),
    check(
      "external_backup_artifacts_identity_check",
      sql`${table.objectVersion} IS NOT NULL OR ${table.objectEtag} IS NOT NULL`
    ),
    check(
      "external_backup_artifacts_size_check",
      sql`${table.sizeBytes} ~ '^[0-9]+$' AND ${table.sizeBytes}::numeric BETWEEN 1 AND 2147483648`
    ),
    check(
      "external_backup_artifacts_archive_format_check",
      sql`${table.archiveFormat} = 'postgres-custom'`
    ),
    check(
      "external_backup_artifacts_source_version_check",
      sql`${table.sourcePostgresVersion} ~ '^[1-9][0-9]*(\\.[0-9]+){0,2}$'`
    ),
    check(
      "external_backup_artifacts_sha256_check",
      sql`${table.sha256} IS NULL OR ${table.sha256} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "external_backup_artifacts_status_check",
      sql`${table.status} IN ('registering', 'registered', 'verifying', 'verified', 'failed')`
    ),
    check(
      "external_backup_artifacts_registered_metadata_check",
      sql`(
        ${table.status} IN ('registering', 'failed')
        OR (
          ${table.sha256} IS NOT NULL
          AND ${table.listingEvidence} IS NOT NULL
          AND ${table.verifierImage} IS NOT NULL
          AND ${table.registeredAt} IS NOT NULL
        )
      )`
    )
  ]
);

export const externalBackupArtifactsRelations = relations(externalBackupArtifacts, ({ one }) => ({
  team: one(teams, {
    fields: [externalBackupArtifacts.teamId],
    references: [teams.id]
  }),
  destination: one(backupDestinations, {
    fields: [externalBackupArtifacts.destinationId],
    references: [backupDestinations.id]
  }),
  registeredBy: one(users, {
    fields: [externalBackupArtifacts.registeredByUserId],
    references: [users.id]
  })
}));
