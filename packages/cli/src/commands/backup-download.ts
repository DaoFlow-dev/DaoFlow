import chalk from "chalk";
import type { BackupRunDetailsOutput } from "../trpc-contract";

export interface BackupDownloadInfo {
  id: string;
  status: string;
  artifact: string | null;
  size: number | null;
  message: string;
}

export function buildBackupDownloadInfo(run: BackupRunDetailsOutput): BackupDownloadInfo {
  return {
    id: run.id,
    status: run.status,
    artifact: run.artifactPath,
    size: run.bytesWritten,
    message:
      run.status === "succeeded"
        ? "Use rclone to download from the artifact path"
        : "Backup has not completed successfully"
  };
}

export function renderBackupDownloadInfo(info: BackupDownloadInfo): void {
  console.log(chalk.bold("\n📥 Backup Download Info\n"));
  console.log(`  ID:         ${info.id}`);
  console.log(`  Status:     ${info.status}`);
  console.log(`  Artifact:   ${info.artifact ?? chalk.dim("none")}`);
  if (typeof info.size === "number") {
    console.log(`  Size:       ${(info.size / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log("");
}
