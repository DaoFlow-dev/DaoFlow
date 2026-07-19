import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { archiveEncryptAsync } from "../../rclone-archive";
import { copyToRemoteAsync, listRemoteAsync } from "../../rclone-executor";
import { runCancellableLocalCommand } from "../../cancellable-local-command";
import type { BackupPolicyResolved, BackupRunResult } from "./backup-activity-types";
import { decryptDestinationForVolumeOperation } from "./destination-operation";
import { runWithRemoteTransferActivity } from "./remote-transfer-activity";
import { stageRemoteVolumeBackup } from "./remote-volume-transfer";

const localHostname = hostname().toLowerCase();

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "host.docker.internal" ||
    normalized === localHostname
  );
}

async function stageDockerVolume(
  volumeName: string,
  stagingDir: string,
  signal?: AbortSignal
): Promise<string> {
  throwIfCancelled(signal);
  await mkdir(stagingDir, { recursive: true });
  const stagingPath = join(stagingDir, "volume-data");
  await mkdir(stagingPath, { recursive: true });
  throwIfCancelled(signal);

  await runCancellableLocalCommand(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/source:ro`,
      "-v",
      `${stagingPath}:/dest`,
      "alpine",
      "sh",
      "-c",
      "cp -a /source/. /dest/"
    ],
    {
      description: `Failed to stage Docker volume "${volumeName}"`,
      timeoutMs: 300_000,
      signal
    }
  );
  return stagingPath;
}

export async function executeBackupCopy(
  resolved: BackupPolicyResolved,
  runId: string,
  sourcePath?: string
): Promise<BackupRunResult> {
  return runWithRemoteTransferActivity((signal) =>
    executeBackupCopyWithSignal(resolved, runId, sourcePath, signal)
  );
}

async function executeBackupCopyWithSignal(
  resolved: BackupPolicyResolved,
  runId: string,
  sourcePath: string | undefined,
  signal: AbortSignal | undefined
): Promise<BackupRunResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const remotePath = `${resolved.policyName}/${timestamp}`;

  let effectiveSource = sourcePath ?? resolved.mountPath;
  let stagedDir: string | null = null;
  let encryptedArchivePath: string | null = null;
  let operationError: unknown;
  let operationResult: BackupRunResult | undefined;

  try {
    if (!sourcePath) {
      if (!isLocalHost(resolved.serverHost)) {
        const remoteStage = await stageRemoteVolumeBackup(resolved, runId);
        if (!remoteStage) throw new Error("Remote volume staging did not produce an archive.");
        stagedDir = remoteStage.localStagingDir;
        effectiveSource = remoteStage.archivePath;
      } else if (resolved.sourceKind === "docker-volume") {
        const stagingBase = join("/tmp", `daoflow-backup-${runId}`);
        stagedDir = stagingBase;
        effectiveSource = await stageDockerVolume(resolved.volumeName, stagingBase, signal);
      } else if (!existsSync(resolved.mountPath)) {
        throw new Error(`Registered bind mount ${resolved.mountPath} is unavailable.`);
      }
    }

    const destination = await decryptDestinationForVolumeOperation({
      volumeId: resolved.volumeId,
      destinationId: resolved.destinationId
    });
    let uploadSource = effectiveSource;
    if (
      destination.encryptionMode === "archive-7z" ||
      destination.encryptionMode === "archive-zip"
    ) {
      if (!destination.encryptionPassword) {
        throw new Error("Archive encryption requires a destination encryption password.");
      }
      const encryptedArchive = await archiveEncryptAsync(
        effectiveSource,
        destination.encryptionPassword,
        destination.encryptionMode,
        signal
      );
      encryptedArchivePath = encryptedArchive.archivePath;
      if (!encryptedArchive.success) {
        throwIfCancelled(signal);
        throw new Error(
          `Archive encryption failed: ${encryptedArchive.error ?? "unknown archive error"}`
        );
      }
      uploadSource = encryptedArchive.archivePath;
    }

    const copyResult = await copyToRemoteAsync(destination, uploadSource, remotePath, {
      cancellationSignal: signal
    });
    if (!copyResult.success) {
      throw new Error(`rclone copy failed: ${copyResult.error ?? copyResult.output}`);
    }

    let sizeBytes = 0;
    try {
      const listing = await listRemoteAsync(destination, remotePath, {
        cancellationSignal: signal
      });
      if (!listing.success) throw new Error(listing.error ?? listing.output);
      for (const line of listing.output.split("\n")) {
        const match = /^\s*(\d+)\s/.exec(line.trim());
        if (match) {
          sizeBytes += parseInt(match[1], 10);
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[backup] Could not estimate backup size for run ${runId}`);
    }

    operationResult = {
      runId,
      artifactPath: remotePath,
      sizeBytes
    };
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors: Error[] = [];
  if (encryptedArchivePath) {
    try {
      await rm(encryptedArchivePath, { force: true });
    } catch (error) {
      cleanupErrors.push(asCleanupError(error, "encrypted backup archive"));
    }
  }
  if (stagedDir) {
    try {
      await rm(stagedDir, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(asCleanupError(error, "plaintext backup staging"));
    }
  }
  if (cleanupErrors.length > 0) {
    if (signal?.aborted) throw cancellationWithCleanup(signal, cleanupErrors);
    throw new AggregateError(
      operationError ? [operationError, ...cleanupErrors] : cleanupErrors,
      operationError
        ? "Backup failed and sensitive staging cleanup also failed."
        : "Backup artifact was copied, but sensitive staging cleanup failed."
    );
  }
  if (operationError) {
    if (signal?.aborted) throw cancellationReason(signal);
    throw operationError instanceof Error
      ? operationError
      : new Error("Backup operation failed with a non-error value.");
  }
  if (!operationResult) throw new Error("Backup copy did not produce a result.");
  return operationResult;
}

function asCleanupError(error: unknown, resource: string): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Could not remove ${resource}: ${detail}`);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationReason(signal);
}

function cancellationReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Backup copy was cancelled.");
}

function cancellationWithCleanup(signal: AbortSignal, cleanupErrors: Error[]): Error {
  const cancellation = cancellationReason(signal);
  const cleanup = new AggregateError(cleanupErrors, "Sensitive backup staging cleanup failed.");
  cancellation.message = `${cancellation.message} Cleanup also failed: ${cleanupErrors
    .map((error) => error.message)
    .join("; ")}`;
  cancellation.cause = cancellation.cause
    ? new AggregateError([cancellation.cause, cleanup], "Cancellation and cleanup failures.")
    : cleanup;
  return cancellation;
}

export const backupCopyActivityTestHooks = { stageDockerVolume };
