/**
 * Phase 6 Security Helpers:
 * Task #39: Password rotation support
 * Task #40: Temp file cleanup
 * Task #43: Secret storage for encryption keys
 * Task #44: Audit trail for encrypted access
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";

// ── Temp File Cleanup (Task #40) ────────────────────────────

/**
 * Clean up temporary rclone config and archive files.
 * Should be called in a finally block after backup/restore operations.
 */
export async function cleanupTempFiles(
  patterns: string[] = ["daoflow-rclone-", "daoflow-archive-"]
): Promise<{ cleaned: number }> {
  const tempDir = tmpdir();
  let cleaned = 0;

  try {
    const files = await readdir(tempDir);
    for (const file of files) {
      if (patterns.some((p) => file.startsWith(p))) {
        try {
          await unlink(join(tempDir, file));
          cleaned++;
        } catch (err) {
          // Ignore ENOENT (TOCTOU), log others
          if (
            err instanceof Error &&
            "code" in err &&
            (err as NodeJS.ErrnoException).code !== "ENOENT"
          ) {
            console.warn(`Failed to clean temp file ${file}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      "Failed to read temp directory for cleanup:",
      err instanceof Error ? err.message : err
    );
  }

  return { cleaned };
}

// ── Password Rotation (Task #39) ────────────────────────────

/**
 * Re-encrypt a backup with a new password.
 * Steps: download with old password → re-encrypt with new → upload → update metadata.
 */
export interface PasswordRotationPlan {
  policyId: string;
  backupRunIds: string[];
  oldPasswordEnvVar: string;
  newPasswordEnvVar: string;
}

export function generateRotationPlan(policyId: string, runIds: string[]): PasswordRotationPlan {
  return {
    policyId,
    backupRunIds: runIds,
    oldPasswordEnvVar: `BACKUP_PASSWORD_${policyId.toUpperCase()}`,
    newPasswordEnvVar: `BACKUP_PASSWORD_${policyId.toUpperCase()}_NEW`
  };
}

// ── Secret Storage (Task #43) ──────────────────────────────

/**
 * Resolve encryption password from environment or future vault integration.
 * Priority: specific env var > general env var > throw error.
 */
export function resolveEncryptionPassword(policyId?: string): string {
  if (policyId) {
    const specific = process.env[`BACKUP_PASSWORD_${policyId.toUpperCase()}`];
    if (specific) return specific;
  }

  const general = process.env.BACKUP_ENCRYPTION_PASSWORD;
  if (general) return general;

  throw new Error(
    `No encryption password found. Set BACKUP_ENCRYPTION_PASSWORD or BACKUP_PASSWORD_${policyId?.toUpperCase() ?? "POLICY_ID"} environment variable.`
  );
}

// ── Audit Trail for Encrypted Access (Task #44) ────────────

/**
 * Log when encryption passwords are accessed or used.
 */
export async function auditEncryptedAccess(params: {
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  action: "password.read" | "password.used" | "password.rotated";
  policyId: string;
  context?: string;
}) {
  await db.insert(auditEntries).values({
    organizationId: "org_default",
    actorType: "user",
    actorId: params.actorId,
    actorEmail: params.actorEmail ?? null,
    actorRole: params.actorRole,
    targetResource: `backup-policy/${params.policyId}`,
    action: `encryption.${params.action}`,
    inputSummary: params.context ?? `Encryption ${params.action} for policy ${params.policyId}`,
    permissionScope: "secrets:read",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: params.policyId,
      detail: params.context
    }
  });
}
