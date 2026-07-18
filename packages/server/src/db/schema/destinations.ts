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
import { teams } from "./teams";

/**
 * backup_destinations — First-class backup storage targets.
 *
 * Supports S3-compatible, rclone-native (Google Drive, OneDrive, Dropbox, SFTP),
 * and local filesystem backends. Replaces the hardcoded "s3-compatible" strings
 * previously scattered through the backup service.
 *
 * Design: One row = one configured remote. backupPolicies references this via FK.
 * Secret-bearing values are stored together in a versioned encrypted credential envelope.
 * The legacy plaintext columns remain only while staged upgrades are supported.
 */
export const backupDestinations = pgTable(
  "backup_destinations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),

    // ── Credential envelope ─────────────────────────────────
    // AES-256-GCM encrypted JSON containing every secret-bearing destination field.
    credentialsEncrypted: text("credentials_encrypted"),
    credentialEnvelopeVersion: integer("credential_envelope_version"),
    // Non-secret identifier for the encryption key used to create the envelope.
    credentialKeyId: varchar("credential_key_id", { length: 64 }),

    // ── Provider type ──────────────────────────────────────
    // "s3" | "local" | "gdrive" | "onedrive" | "dropbox" | "sftp" | "rclone"
    provider: varchar("provider", { length: 30 }).notNull(),

    // ── S3-compatible fields ───────────────────────────────
    // Legacy plaintext credential fields. New writes must leave these null.
    accessKey: text("access_key"),
    secretAccessKey: text("secret_access_key"),
    bucket: text("bucket"),
    region: varchar("region", { length: 40 }),
    endpoint: text("endpoint"),
    // Sub-provider: AWS, Cloudflare, Minio, DigitalOcean, etc.
    s3Provider: varchar("s3_provider", { length: 40 }),

    // ── Rclone-native fields ───────────────────────────────
    // Rclone backend type (e.g. "drive", "onedrive", "dropbox", "sftp")
    rcloneType: varchar("rclone_type", { length: 30 }),
    // Legacy plaintext config blob for custom rclone setups
    rcloneConfig: text("rclone_config"),
    // Remote path within the backend (e.g. "backups/daoflow")
    rcloneRemotePath: text("rclone_remote_path"),

    // ── OAuth token (legacy plaintext) ─────────────────────
    oauthToken: text("oauth_token"),
    oauthTokenExpiry: timestamp("oauth_token_expiry"),

    // ── Encryption settings ─────────────────────────────────
    // "none" = no encryption (default)
    // "rclone-crypt" = rclone crypt overlay remote (transparent, streaming)
    // "archive-7z" = pre-upload 7z AES-256 encrypted archive
    // "archive-zip" = pre-upload zip AES encrypted archive
    encryptionMode: varchar("encryption_mode", { length: 20 }).default("none").notNull(),
    // Legacy plaintext password for rclone-crypt or archive encryption
    encryptionPassword: text("encryption_password"),
    // Salt/password2 for rclone-crypt (optional, stronger encryption)
    encryptionSalt: text("encryption_salt"),
    // Filename encryption for rclone-crypt: "standard" | "obfuscate" | "off"
    filenameEncryption: varchar("filename_encryption", { length: 20 }).default("standard"),

    // ── Local filesystem (for dev/testing) ─────────────────
    localPath: text("local_path"),

    // ── Storage Quota ─────────────────────────────────────────
    /** Maximum allowed storage in bytes (null = unlimited) */
    quotaBytes: text("quota_bytes"), // text to avoid int overflow on large values
    /** Warning threshold as percentage (0-100, default 80) */
    quotaWarningPercent: integer("quota_warning_percent").default(80),

    // ── Metadata ───────────────────────────────────────────
    organizationId: varchar("organization_id", { length: 32 }),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: varchar("last_test_result", { length: 20 }), // "success" | "failed"
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("backup_destinations_team_id_idx").on(table.teamId),
    index("backup_destinations_provider_idx").on(table.provider),
    index("backup_destinations_org_idx").on(table.organizationId),
    check(
      "backup_destinations_credentials_state_check",
      sql`(
        (
          ${table.credentialsEncrypted} IS NULL
          AND ${table.credentialEnvelopeVersion} IS NULL
          AND ${table.credentialKeyId} IS NULL
          AND ${table.accessKey} IS NULL
          AND ${table.secretAccessKey} IS NULL
          AND ${table.oauthToken} IS NULL
          AND ${table.rcloneConfig} IS NULL
          AND ${table.encryptionPassword} IS NULL
          AND ${table.encryptionSalt} IS NULL
        )
        OR
        (
          ${table.credentialsEncrypted} IS NOT NULL
          AND ${table.credentialEnvelopeVersion} IS NOT NULL
          AND ${table.credentialKeyId} IS NOT NULL
          AND ${table.accessKey} IS NULL
          AND ${table.secretAccessKey} IS NULL
          AND ${table.oauthToken} IS NULL
          AND ${table.rcloneConfig} IS NULL
          AND ${table.encryptionPassword} IS NULL
          AND ${table.encryptionSalt} IS NULL
        )
      )`
    )
  ]
);

export const backupDestinationsRelations = relations(backupDestinations, () => ({}));

// ── Provider constants ─────────────────────────────────────
// Shared between server and client (exported from @daoflow/shared ideally)

export type BackupProvider = "s3" | "local" | "gdrive" | "onedrive" | "dropbox" | "sftp" | "rclone";

export const BACKUP_PROVIDERS: { key: BackupProvider; name: string; icon: string }[] = [
  { key: "s3", name: "S3-Compatible Storage", icon: "☁️" },
  { key: "gdrive", name: "Google Drive", icon: "📁" },
  { key: "onedrive", name: "Microsoft OneDrive", icon: "📂" },
  { key: "dropbox", name: "Dropbox", icon: "📦" },
  { key: "sftp", name: "SFTP / SSH", icon: "🔒" },
  { key: "local", name: "Local Filesystem", icon: "💾" },
  { key: "rclone", name: "Custom Rclone Config", icon: "⚙️" }
];

export const S3_SUB_PROVIDERS: { key: string; name: string }[] = [
  { key: "AWS", name: "Amazon Web Services (AWS) S3" },
  { key: "Cloudflare", name: "Cloudflare R2" },
  { key: "DigitalOcean", name: "DigitalOcean Spaces" },
  { key: "GCS", name: "Google Cloud Storage" },
  { key: "Minio", name: "MinIO" },
  { key: "Wasabi", name: "Wasabi" },
  { key: "Linode", name: "Linode Object Storage" },
  { key: "Scaleway", name: "Scaleway Object Storage" },
  { key: "Storj", name: "Storj (S3 Gateway)" },
  { key: "IBMCOS", name: "IBM Cloud Object Storage" },
  { key: "Ceph", name: "Ceph Object Storage" },
  { key: "Other", name: "Any S3-compatible provider" }
];
