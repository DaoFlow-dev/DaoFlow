import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * backup_destinations — First-class backup storage targets.
 *
 * Supports S3-compatible, rclone-native (Google Drive, OneDrive, Dropbox, SFTP),
 * and local filesystem backends. Replaces the hardcoded "s3-compatible" strings
 * previously scattered through the backup service.
 *
 * Design: One row = one configured remote. backupPolicies references this via FK.
 * Secrets (accessKey, secretAccessKey, oauthToken) should be encrypted at rest.
 */
export const backupDestinations = pgTable(
  "backup_destinations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),

    // ── Provider type ──────────────────────────────────────
    // "s3" | "local" | "gdrive" | "onedrive" | "dropbox" | "sftp" | "rclone"
    provider: varchar("provider", { length: 30 }).notNull(),

    // ── S3-compatible fields ───────────────────────────────
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
    // Encrypted INI-style config blob for custom rclone setups
    rcloneConfig: text("rclone_config"),
    // Remote path within the backend (e.g. "backups/daoflow")
    rcloneRemotePath: text("rclone_remote_path"),

    // ── OAuth token (encrypted, for cloud providers) ───────
    oauthToken: text("oauth_token"),
    oauthTokenExpiry: timestamp("oauth_token_expiry"),

    // ── Local filesystem (for dev/testing) ─────────────────
    localPath: text("local_path"),

    // ── Metadata ───────────────────────────────────────────
    organizationId: varchar("organization_id", { length: 32 }),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: varchar("last_test_result", { length: 20 }), // "success" | "failed"
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    index("backup_destinations_provider_idx").on(table.provider),
    index("backup_destinations_org_idx").on(table.organizationId)
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
