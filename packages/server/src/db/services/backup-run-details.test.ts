import { describe, expect, it } from "vitest";
import {
  appendBackupRunLogEntries,
  getBackupRunLogsState,
  MAX_BACKUP_RUN_LOG_ENTRIES,
  MAX_BACKUP_RUN_LOG_MESSAGE_LENGTH,
  MAX_BACKUP_RUN_LOG_PHASE_LENGTH
} from "./backup-run-details";

describe("backup run details helpers", () => {
  it("caps persisted backup run logs to the most recent entries", () => {
    const existingEntries = Array.from({ length: MAX_BACKUP_RUN_LOG_ENTRIES }, (_, index) => ({
      timestamp: `2026-03-20T00:${String(index).padStart(2, "0")}:00.000Z`,
      level: "info" as const,
      phase: "backup",
      message: `entry-${index}`
    }));

    const nextEntries = appendBackupRunLogEntries(existingEntries, {
      timestamp: "2026-03-20T04:00:00.000Z",
      level: "error",
      phase: "failed",
      message: "newest-entry"
    });

    expect(nextEntries).toHaveLength(MAX_BACKUP_RUN_LOG_ENTRIES);
    expect(nextEntries[0]?.message).toBe("entry-1");
    expect(nextEntries.at(-1)?.message).toBe("newest-entry");
  });

  it("truncates oversized phase and message fields before persistence", () => {
    const nextEntries = appendBackupRunLogEntries([], {
      timestamp: "2026-03-20T04:00:00.000Z",
      level: "warn",
      phase: "x".repeat(MAX_BACKUP_RUN_LOG_PHASE_LENGTH + 10),
      message: "m".repeat(MAX_BACKUP_RUN_LOG_MESSAGE_LENGTH + 25)
    });

    expect(nextEntries[0]?.phase).toHaveLength(MAX_BACKUP_RUN_LOG_PHASE_LENGTH);
    expect(nextEntries[0]?.message).toHaveLength(MAX_BACKUP_RUN_LOG_MESSAGE_LENGTH);
  });

  it("distinguishes unavailable, empty, streaming, and available log states", () => {
    expect(getBackupRunLogsState(null, "failed")).toBe("unavailable");
    expect(getBackupRunLogsState([], "failed")).toBe("empty");
    expect(
      getBackupRunLogsState(
        [
          {
            timestamp: "2026-03-20T04:00:00.000Z",
            level: "info",
            phase: "backup",
            message: "streaming"
          }
        ],
        "running"
      )
    ).toBe("streaming");
    expect(
      getBackupRunLogsState(
        [
          {
            timestamp: "2026-03-20T04:00:00.000Z",
            level: "info",
            phase: "backup",
            message: "complete"
          }
        ],
        "succeeded"
      )
    ).toBe("available");
  });
});
