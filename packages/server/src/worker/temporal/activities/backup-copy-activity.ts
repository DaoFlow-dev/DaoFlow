import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { archiveEncrypt } from "../../rclone-archive";
import { copyToRemote, listRemote } from "../../rclone-executor";
import type { BackupPolicyResolved, BackupRunResult } from "./backup-activity-types";
import { decryptDestinationForVolumeOperation } from "./destination-operation";

function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function stageDockerVolume(volumeName: string, stagingDir: string): string {
  mkdirSync(stagingDir, { recursive: true });
  const stagingPath = join(stagingDir, "volume-data");
  mkdirSync(stagingPath, { recursive: true });

  const result = spawnSync(
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
    { timeout: 300_000 }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(
      `Failed to stage Docker volume "${volumeName}": ${stderr || `exit code ${result.status}`}`
    );
  }

  return stagingPath;
}

export async function executeBackupCopy(
  resolved: BackupPolicyResolved,
  runId: string,
  sourcePath?: string
): Promise<BackupRunResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const remotePath = `${resolved.policyName}/${timestamp}`;

  let effectiveSource = sourcePath ?? resolved.mountPath;
  let stagedDir: string | null = null;
  let encryptedArchivePath: string | null = null;

  if (!sourcePath && isLocalHost(resolved.serverHost) && !existsSync(resolved.mountPath)) {
    const stagingBase = join("/tmp", `daoflow-backup-${runId}`);
    stagedDir = stagingBase;
    effectiveSource = stageDockerVolume(resolved.volumeName, stagingBase);
  }

  try {
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
      const encryptedArchive = archiveEncrypt(
        effectiveSource,
        destination.encryptionPassword,
        destination.encryptionMode
      );
      encryptedArchivePath = encryptedArchive.archivePath;
      if (!encryptedArchive.success) {
        throw new Error(
          `Archive encryption failed: ${encryptedArchive.error ?? "unknown archive error"}`
        );
      }
      uploadSource = encryptedArchive.archivePath;
    }

    const copyResult = copyToRemote(destination, uploadSource, remotePath);
    if (!copyResult.success) {
      throw new Error(`rclone copy failed: ${copyResult.error ?? copyResult.output}`);
    }

    let sizeBytes = 0;
    try {
      const listing = listRemote(destination, remotePath);
      for (const line of listing.output.split("\n")) {
        const match = /^\s*(\d+)\s/.exec(line.trim());
        if (match) {
          sizeBytes += parseInt(match[1], 10);
        }
      }
    } catch {
      console.warn(`[backup] Could not estimate backup size for run ${runId}`);
    }

    return {
      runId,
      artifactPath: remotePath,
      sizeBytes
    };
  } finally {
    if (encryptedArchivePath) {
      try {
        rmSync(encryptedArchivePath, { force: true });
      } catch {
        console.warn(`[backup] Could not clean up encrypted archive ${encryptedArchivePath}`);
      }
    }
    if (stagedDir) {
      try {
        rmSync(stagedDir, { recursive: true, force: true });
      } catch {
        console.warn(`[backup] Could not clean up staging dir ${stagedDir}`);
      }
    }
  }
}
