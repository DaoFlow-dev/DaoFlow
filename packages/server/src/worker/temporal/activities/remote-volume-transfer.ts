/**
 * Remote volume backup/restore staging over DaoFlow's pinned SSH transport.
 * Only the operation-specific staging directory is ever removed remotely.
 */

import { eq } from "drizzle-orm";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { db } from "../../../db/connection";
import { servers } from "../../../db/schema/servers";
import {
  resolveExecutionTarget,
  withPreparedExecutionTarget,
  type ExecutionTarget
} from "../../execution-target";
import { scpDownload, scpUpload } from "../../ssh-file-transfer";
import { shellQuote, type SSHTarget } from "../../ssh-connection";
import {
  REMOTE_VOLUME_CLEANUP_TIMEOUT_MS,
  REMOTE_VOLUME_TRANSFER_TIMEOUT_MS,
  runRemoteTransferCommand
} from "./remote-transfer-command";
import { runWithRemoteTransferActivity } from "./remote-transfer-activity";
import { runWithRequiredCleanup } from "./required-cleanup";
import { removeSensitiveStaging } from "./sensitive-staging-cleanup";
import type { VolumeSourceKind } from "./volume-source-kind";

const REMOTE_VOLUME_ARCHIVE_NAME = "volume.tar";

export interface RemoteVolumeTransferContext {
  serverId: string;
  teamId: string;
  volumeName: string;
  mountPath: string;
  sourceKind: VolumeSourceKind;
}

export interface RemoteVolumeBackupStage {
  archivePath: string;
  localStagingDir: string;
}

export interface RemoteVolumeRestoreResult {
  bytesRestored: number;
}

/**
 * Builds the remote archive, retrieves it locally, and removes the unique
 * remote workspace before returning. A local target returns null unchanged.
 */
export async function stageRemoteVolumeBackup(
  context: RemoteVolumeTransferContext,
  runId: string
): Promise<RemoteVolumeBackupStage | null> {
  assertSafeVolumeContext(context);
  const target = await resolveVolumeExecutionTarget(
    context,
    `backup_${assertSafeOperationId(runId)}`
  );
  if (target.mode === "local") return null;

  const remoteStagingDir = createRemoteStagingDir(target.remoteWorkDir, "volume-backup");
  const remoteArchivePath = posix.join(remoteStagingDir, REMOTE_VOLUME_ARCHIVE_NAME);
  const localStagingDir = mkdtempSync(join(tmpdir(), `daoflow-backup-${runId}-`));
  const localArchivePath = join(localStagingDir, REMOTE_VOLUME_ARCHIVE_NAME);

  try {
    return await runWithRemoteTransferActivity((signal) =>
      withPreparedExecutionTarget(target, async (preparedTarget) => {
        if (preparedTarget.mode !== "remote") return null;
        return runWithRequiredCleanup(
          async () => {
            await runRemoteTransferCommand(
              preparedTarget.ssh,
              buildRemoteBackupCommand(context, remoteStagingDir, remoteArchivePath),
              "Creating remote volume archive",
              REMOTE_VOLUME_TRANSFER_TIMEOUT_MS,
              signal
            );
            const download = await scpDownload(
              preparedTarget.ssh,
              remoteArchivePath,
              localArchivePath,
              () => undefined,
              { timeoutMs: REMOTE_VOLUME_TRANSFER_TIMEOUT_MS, signal }
            );
            assertTransferSucceeded(download.exitCode, "Downloading remote volume archive");
            return { archivePath: localArchivePath, localStagingDir };
          },
          () => cleanupRemoteStaging(preparedTarget.ssh, remoteStagingDir),
          "Remote volume backup and staging cleanup both failed."
        );
      })
    );
  } catch (error) {
    return runWithRequiredCleanup(
      () => Promise.reject(asRemoteTransferError(error)),
      () => removeSensitiveStaging(localStagingDir),
      "Remote volume backup and local staging cleanup both failed."
    );
  }
}

/**
 * Uploads a local volume archive and restores it on the selected remote host.
 * A local target returns null so the existing local restore path remains intact.
 */
export async function restoreRemoteVolumeArchive(
  context: RemoteVolumeTransferContext,
  restoreId: string,
  localArchivePath: string
): Promise<RemoteVolumeRestoreResult | null> {
  assertSafeVolumeContext(context);
  const archiveStats = statSync(localArchivePath);
  if (!archiveStats.isFile()) {
    throw new Error("Remote volume restore requires a local archive file.");
  }

  const target = await resolveVolumeExecutionTarget(
    context,
    `restore_${assertSafeOperationId(restoreId)}`
  );
  if (target.mode === "local") return null;

  const remoteStagingDir = createRemoteStagingDir(target.remoteWorkDir, "volume-restore");
  const remoteArchivePath = posix.join(remoteStagingDir, REMOTE_VOLUME_ARCHIVE_NAME);

  return runWithRemoteTransferActivity((signal) =>
    withPreparedExecutionTarget(target, async (preparedTarget) => {
      if (preparedTarget.mode !== "remote") return null;
      return runWithRequiredCleanup(
        async () => {
          await runRemoteTransferCommand(
            preparedTarget.ssh,
            `mkdir -p -- ${shellQuote(remoteStagingDir)} && chmod 700 -- ${shellQuote(remoteStagingDir)}`,
            "Preparing remote volume restore staging",
            REMOTE_VOLUME_TRANSFER_TIMEOUT_MS,
            signal
          );
          const upload = await scpUpload(
            preparedTarget.ssh,
            localArchivePath,
            remoteArchivePath,
            () => undefined,
            { timeoutMs: REMOTE_VOLUME_TRANSFER_TIMEOUT_MS, signal }
          );
          assertTransferSucceeded(upload.exitCode, "Uploading remote volume archive");
          await runRemoteTransferCommand(
            preparedTarget.ssh,
            buildRemoteRestoreCommand(context, remoteStagingDir, remoteArchivePath),
            "Restoring remote volume archive",
            REMOTE_VOLUME_TRANSFER_TIMEOUT_MS,
            signal
          );
          return { bytesRestored: archiveStats.size };
        },
        () => cleanupRemoteStaging(preparedTarget.ssh, remoteStagingDir),
        "Remote volume restore and staging cleanup both failed."
      );
    })
  );
}

function assertSafeVolumeContext(context: RemoteVolumeTransferContext): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(context.volumeName)) {
    throw new Error("Remote volume name contains unsafe characters.");
  }
  assertSafeMountPath(context.mountPath);
  assertSafeOperationId(context.serverId);
  assertSafeOperationId(context.teamId);
}

function assertSafeOperationId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("Remote staging identifier contains unsafe characters.");
  }
  return value;
}

function assertSafeMountPath(value: string): void {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    !posix.isAbsolute(value) ||
    value === "/" ||
    value.includes("\0") ||
    /[\r\n]/.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Registered remote mount path is unsafe.");
  }
}

async function resolveVolumeExecutionTarget(
  context: Pick<RemoteVolumeTransferContext, "serverId" | "teamId">,
  operationId: string
): Promise<ExecutionTarget> {
  const [server] = await db.select().from(servers).where(eq(servers.id, context.serverId)).limit(1);
  if (!server) {
    throw new Error("The registered backup server is no longer available.");
  }
  return resolveExecutionTarget(server, operationId, context.teamId);
}

function buildRemoteBackupCommand(
  context: RemoteVolumeTransferContext,
  remoteStagingDir: string,
  remoteArchivePath: string
): string {
  if (context.sourceKind === "bind-mount") {
    return [
      "set -eu",
      `test -d ${shellQuote(context.mountPath)}`,
      `mkdir -p -- ${shellQuote(remoteStagingDir)}`,
      `chmod 700 -- ${shellQuote(remoteStagingDir)}`,
      `tar -C ${shellQuote(context.mountPath)} -cf ${shellQuote(remoteArchivePath)} .`
    ].join("\n");
  }
  const volumeSource = `${context.volumeName}:/source:ro`;
  const stagingDestination = `${remoteStagingDir}:/dest`;
  return [
    "set -eu",
    `mkdir -p -- ${shellQuote(remoteStagingDir)}`,
    `chmod 700 -- ${shellQuote(remoteStagingDir)}`,
    `docker volume inspect -- ${shellQuote(context.volumeName)} >/dev/null`,
    `docker run --rm -v ${shellQuote(volumeSource)} -v ${shellQuote(stagingDestination)} alpine tar -C /source -cf /dest/${REMOTE_VOLUME_ARCHIVE_NAME} .`
  ].join("\n");
}

function buildRemoteRestoreCommand(
  context: RemoteVolumeTransferContext,
  remoteStagingDir: string,
  remoteArchivePath: string
): string {
  if (context.sourceKind === "bind-mount") {
    return [
      "set -eu",
      `[ -f ${shellQuote(remoteArchivePath)} ]`,
      `test -d ${shellQuote(context.mountPath)}`,
      `tar -xf ${shellQuote(remoteArchivePath)} -C ${shellQuote(context.mountPath)}`
    ].join("\n");
  }
  const volumeDestination = `${context.volumeName}:/dest`;
  const stagingSource = `${remoteStagingDir}:/source:ro`;
  return [
    "set -eu",
    `[ -f ${shellQuote(remoteArchivePath)} ]`,
    `docker volume inspect -- ${shellQuote(context.volumeName)} >/dev/null`,
    `docker run --rm -v ${shellQuote(volumeDestination)} -v ${shellQuote(stagingSource)} alpine tar -xf /source/${REMOTE_VOLUME_ARCHIVE_NAME} -C /dest`
  ].join("\n");
}

async function cleanupRemoteStaging(target: SSHTarget, remoteStagingDir: string): Promise<void> {
  await runRemoteTransferCommand(
    target,
    `rm -rf -- ${shellQuote(remoteStagingDir)}`,
    "Cleaning up remote volume staging",
    REMOTE_VOLUME_CLEANUP_TIMEOUT_MS
  );
}

function createRemoteStagingDir(remoteWorkDir: string, operation: string): string {
  return assertSafeRemoteStagingDir(
    posix.join(assertSafeRemoteStagingDir(remoteWorkDir), operation)
  );
}

function assertSafeRemoteStagingDir(remoteStagingDir: string): string {
  if (
    remoteStagingDir.length === 0 ||
    remoteStagingDir.length > 4_096 ||
    !posix.isAbsolute(remoteStagingDir) ||
    remoteStagingDir === "/" ||
    remoteStagingDir.includes(":") ||
    remoteStagingDir.includes("\0") ||
    /[\r\n]/.test(remoteStagingDir) ||
    posix.normalize(remoteStagingDir) !== remoteStagingDir
  ) {
    throw new Error("Remote staging directory is unsafe.");
  }
  return remoteStagingDir;
}

function assertTransferSucceeded(exitCode: number, action: string): void {
  if (exitCode !== 0) {
    throw new Error(`${action} failed with exit code ${exitCode}.`);
  }
}

function asRemoteTransferError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Remote volume transfer failed.");
}

export const remoteVolumeTransferTestHooks = {
  assertSafeMountPath,
  buildRemoteBackupCommand,
  buildRemoteRestoreCommand,
  createRemoteStagingDir
};
