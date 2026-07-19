import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { externalBackupArtifacts } from "../../../db/schema/external-backup-artifacts";
import { backupRestores, type BackupVerificationResult } from "../../../db/schema/storage";
import { writeExternalBackupArtifactAudit } from "../../../db/services/external-backup-artifact-audit";
import type { ExternalArtifactVerificationWorkflowInput } from "../external-artifact-workflow-input";
import {
  downloadExternalArtifact,
  loadExternalArtifactContext,
  temporalExternalArtifactHooks,
  type ExternalArtifactContext
} from "./external-backup-artifact-activity-shared";
import {
  createExternalArtifactWorkspace,
  removeExternalArtifactWorkspace,
  safeExternalArtifactError
} from "./external-backup-artifact-runtime";
import { verifyPostgresRestore } from "./postgres-restore-verification";

export async function verifyExternalBackupArtifact(
  input: ExternalArtifactVerificationWorkflowInput
): Promise<void> {
  const context = await loadExternalArtifactContext(input.artifactId);
  if (!context || !context.artifact.sha256 || !context.artifact.verifierImage) {
    await markExternalRestoreFailed(
      input.restoreId,
      "External artifact is not eligible for verification."
    );
    return;
  }

  const workDir = createExternalArtifactWorkspace(input.restoreId);
  let verification: BackupVerificationResult;
  try {
    await db
      .update(externalBackupArtifacts)
      .set({ status: "verifying", updatedAt: new Date() })
      .where(eq(externalBackupArtifacts.id, context.artifact.id));
    await markExternalRestoreRunning(input.restoreId);
    const downloaded = await downloadExternalArtifact(context, workDir);
    if (downloaded.sha256 !== context.artifact.sha256) {
      throw new Error("Pinned external backup object checksum no longer matches its registration.");
    }
    const result = await verifyPostgresRestore(
      {
        restoreId: input.restoreId,
        localDumpPath: downloaded.path,
        expectedSha256: context.artifact.sha256,
        sourcePostgresVersion: context.artifact.sourcePostgresVersion,
        verifierImage: context.artifact.verifierImage
      },
      temporalExternalArtifactHooks()
    );
    verification = toVerificationResult(result);
  } catch (error) {
    verification = rejectedExternalVerification(context, safeExternalArtifactError(error));
  }

  applyWorkspaceCleanupResult(verification, removeExternalArtifactWorkspace(workDir));
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(backupRestores)
      .set({
        status: verification.success ? "succeeded" : "failed",
        verificationResult: verification,
        error: verification.error ?? null,
        completedAt: now
      })
      .where(eq(backupRestores.id, input.restoreId));
    await tx
      .update(externalBackupArtifacts)
      .set({
        status: verification.success ? "verified" : "registered",
        verifiedAt: verification.success ? now : context.artifact.verifiedAt,
        latestVerification: verification,
        registerError: verification.success ? null : (verification.error ?? "Verification failed."),
        updatedAt: now
      })
      .where(eq(externalBackupArtifacts.id, context.artifact.id));
  });
  await writeExternalBackupArtifactAudit({
    teamId: context.artifact.teamId,
    destinationId: context.artifact.destinationId,
    artifactId: context.artifact.id,
    objectKey: context.artifact.objectKey,
    action: verification.success
      ? "external-artifact.verify.succeeded"
      : "external-artifact.verify.failed",
    permissionScope: "backup:restore",
    outcome: verification.success ? "success" : "failure",
    detail: verification.success
      ? "External backup artifact passed an isolated PostgreSQL restore verification."
      : "External backup artifact failed an isolated PostgreSQL restore verification."
  });
}

function toVerificationResult(
  result: Awaited<ReturnType<typeof verifyPostgresRestore>>
): BackupVerificationResult {
  return {
    version: 1,
    success: result.success,
    checksum: result.checksum,
    sourceEngineVersion: result.sourcePostgresVersion,
    verifierEngineVersion: result.verifierPostgresVersion,
    durationMs: result.durationMs,
    checks: result.checks,
    objectCounts: result.objectCounts,
    cleanup: {
      attempted: result.cleanup.attempted,
      containerRemoved: result.cleanup.containerRemoved,
      workspaceRemoved: false,
      ...(result.cleanup.error ? { error: result.cleanup.error } : {})
    },
    completedAt: result.completedAt,
    ...(result.error ? { error: result.error } : {})
  };
}

function rejectedExternalVerification(
  context: ExternalArtifactContext,
  error: string
): BackupVerificationResult {
  const skipped = { status: "skipped" as const, detail: "Not run." };
  return {
    version: 1,
    success: false,
    checksum: context.artifact.sha256 ?? "",
    sourceEngineVersion: context.artifact.sourcePostgresVersion,
    verifierEngineVersion: context.artifact.verifierImage ?? "unknown",
    durationMs: 0,
    checks: {
      input: { status: "failed", detail: error },
      checksum: skipped,
      verifierImage: skipped,
      archive: skipped,
      container: skipped,
      readiness: skipped,
      restore: skipped,
      catalog: skipped
    },
    objectCounts: { schemas: 0, tables: 0, indexes: 0, functions: 0 },
    cleanup: { attempted: false, containerRemoved: false, workspaceRemoved: false },
    completedAt: new Date().toISOString(),
    error
  };
}

function applyWorkspaceCleanupResult(
  verification: BackupVerificationResult,
  cleanupError: string | null
) {
  verification.cleanup.workspaceRemoved = !cleanupError;
  if (!cleanupError) return;
  verification.success = false;
  verification.cleanup.error = verification.cleanup.error
    ? `${verification.cleanup.error} ${cleanupError}`
    : cleanupError;
  verification.error = verification.error ? `${verification.error} ${cleanupError}` : cleanupError;
}

async function markExternalRestoreRunning(restoreId: string) {
  await db
    .update(backupRestores)
    .set({ status: "running", error: null, startedAt: new Date(), completedAt: null })
    .where(eq(backupRestores.id, restoreId));
}

async function markExternalRestoreFailed(restoreId: string, error: string) {
  await db
    .update(backupRestores)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(backupRestores.id, restoreId));
}

export const externalArtifactVerificationTestHooks = { applyWorkspaceCleanupResult };
