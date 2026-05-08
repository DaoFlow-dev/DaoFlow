import { copyToRemote, listRemote } from "../../rclone-executor";
import type { BackupPolicyResolved, BackupRunResult } from "./backup-activity-types";

export function executeBackupCopy(
  resolved: BackupPolicyResolved,
  runId: string,
  sourcePath = resolved.mountPath
): Promise<BackupRunResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const remotePath = `${resolved.policyName}/${timestamp}`;

  const copyResult = copyToRemote(resolved.destination, sourcePath, remotePath);
  if (!copyResult.success) {
    throw new Error(`rclone copy failed: ${copyResult.error ?? copyResult.output}`);
  }

  let sizeBytes = 0;
  try {
    const listing = listRemote(resolved.destination, remotePath);
    for (const line of listing.output.split("\n")) {
      const match = /^\s*(\d+)\s/.exec(line.trim());
      if (match) {
        sizeBytes += parseInt(match[1], 10);
      }
    }
  } catch {
    console.warn(`[backup] Could not estimate backup size for run ${runId}`);
  }

  return Promise.resolve({
    runId,
    artifactPath: remotePath,
    sizeBytes
  });
}
