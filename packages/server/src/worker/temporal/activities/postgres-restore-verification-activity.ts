import { Context } from "@temporalio/activity";
import { rmSync, statSync } from "node:fs";
import type { BackupVerificationResult } from "../../../db/schema/storage";
import type { DestinationConfig } from "../../rclone-executor";
import { redactActivitySecretValue } from "./activity-secret-redaction";
import { verifyPostgresRestore } from "./postgres-restore-verification";
import { prepareDatabaseRestorePath } from "./restore-execution";
import { findLargestFile } from "./restore-files";
import type { RestoreResolved, RestoreResult } from "./restore-activities";

export async function executePostgresRestoreVerification(
  ctx: RestoreResolved,
  destination: DestinationConfig,
  localPath: string
): Promise<RestoreResult> {
  let bytesRestored = 0;
  let verificationResult: BackupVerificationResult;
  const activityContext = Context.current();

  try {
    assertTrustedVerificationMetadata(ctx);
    const prepared = await prepareDatabaseRestorePath(
      { ...ctx, destination },
      localPath,
      activityContext.cancellationSignal
    );
    if (!prepared.success) throw new Error(prepared.error);
    const dumpPath = findLargestFile(prepared.path);
    if (!dumpPath) throw new Error("No PostgreSQL custom-format dump was downloaded.");
    bytesRestored = statSync(dumpPath).size;

    const result = await verifyPostgresRestore(
      {
        restoreId: ctx.restoreId,
        localDumpPath: dumpPath,
        expectedSha256: ctx.checksum as string,
        sourcePostgresVersion: ctx.databaseEngineVersion as string,
        verifierImage: ctx.databaseImageReference as string
      },
      {
        heartbeat: () => activityContext.heartbeat(),
        cancellationSignal: activityContext.cancellationSignal
      }
    );
    verificationResult = {
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
  } catch (error) {
    if (activityContext.cancellationSignal.aborted) {
      removeVerificationWorkspace(ctx.downloadPath);
      throw error;
    }
    verificationResult = rejectedVerification(
      ctx,
      safeMessage(error, destination.encryptionPassword ?? undefined)
    );
  }

  const workspaceError = removeVerificationWorkspace(ctx.downloadPath);
  verificationResult.cleanup.workspaceRemoved = !workspaceError;
  if (workspaceError) {
    verificationResult.success = false;
    verificationResult.cleanup.error = workspaceError;
    verificationResult.error = verificationResult.error
      ? `${verificationResult.error} Workspace cleanup also failed.`
      : "Verification workspace cleanup failed.";
  }

  return {
    restoreId: ctx.restoreId,
    success: verificationResult.success,
    bytesRestored,
    verificationResult,
    ...(verificationResult.error ? { error: verificationResult.error } : {})
  };
}

function assertTrustedVerificationMetadata(ctx: RestoreResolved): void {
  if (ctx.mode !== "verification" || ctx.backupType !== "database") {
    throw new Error("PostgreSQL verification requires database verification mode.");
  }
  if (ctx.databaseEngine !== "postgres") {
    throw new Error("Isolated restore verification currently supports PostgreSQL backups only.");
  }
  if (ctx.artifactFormat !== "postgres-custom") {
    throw new Error("Backup does not have trusted PostgreSQL custom-format metadata.");
  }
  if (!ctx.checksum || !ctx.databaseEngineVersion || !ctx.databaseImageReference) {
    throw new Error("Backup predates trusted verification metadata; create a new backup first.");
  }
}

function rejectedVerification(ctx: RestoreResolved, error: string): BackupVerificationResult {
  const skipped = { status: "skipped" as const, detail: "Not run." };
  return {
    version: 1,
    success: false,
    checksum: ctx.checksum ?? "",
    sourceEngineVersion: ctx.databaseEngineVersion ?? "unknown",
    verifierEngineVersion: "unknown",
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

function removeVerificationWorkspace(path: string): string | null {
  try {
    rmSync(path, { recursive: true, force: true });
    return null;
  } catch {
    return "Verification workspace could not be removed.";
  }
}

function safeMessage(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : "PostgreSQL verification failed.";
  return redactActivitySecretValue(message.slice(0, 500), secret);
}
