import chalk from "chalk";
import type { BackupRunDetailsOutput } from "../trpc-contract";

export interface BackupDownloadInfo {
  id: string;
  status: string;
  artifact: string | null;
  size: number | null;
  message: string;
}

export type BackupVerificationInfo = {
  id: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  evidence: Record<string, unknown> | null;
  error: string | null;
} | null;

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

export function buildBackupVerificationInfo(run: BackupRunDetailsOutput): BackupVerificationInfo {
  return run.latestVerification
    ? {
        id: run.latestVerification.id,
        status: run.latestVerification.status,
        requestedAt: run.latestVerification.requestedAt,
        completedAt: run.latestVerification.completedAt,
        evidence: run.latestVerification.result,
        error: run.latestVerification.error
      }
    : null;
}

export function renderBackupVerificationInfo(verification: BackupVerificationInfo): void {
  console.log(`  Verification: ${verification?.status ?? "not requested"}`);
  if (verification?.evidence) {
    console.log("  Evidence: recorded (use --json to inspect the checks)");
  } else if (verification?.error) {
    console.log(`  Evidence error: ${verification.error}`);
  }
}
