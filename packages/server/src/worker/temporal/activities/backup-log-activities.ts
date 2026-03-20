import { appendBackupRunLogEntry } from "../../../db/services/backup-run-details";

export interface BackupRunLogInput {
  runId: string;
  level: "info" | "warn" | "error";
  phase: string;
  message: string;
}

export async function appendBackupRunLog(input: BackupRunLogInput): Promise<void> {
  await appendBackupRunLogEntry(input.runId, {
    level: input.level,
    phase: input.phase,
    message: input.message
  });
}
