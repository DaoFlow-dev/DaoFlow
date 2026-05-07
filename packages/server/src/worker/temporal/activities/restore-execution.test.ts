import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processRunner } from "../../process-runner";
import { executeRestoreArtifact } from "./restore-execution";
import { restoreDatabaseTestHooks } from "./restore-database";
import type { RestoreResolved } from "./restore-activities";

afterEach(() => {
  vi.restoreAllMocks();
});

function restoreContext(overrides: Partial<RestoreResolved> = {}): RestoreResolved {
  return {
    restoreId: "brest_test",
    runId: "brun_test",
    artifactPath: "postgres-policy/2026-05-07",
    destination: {
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups"
    },
    targetPath: "/tmp/daoflow-restore-target",
    downloadPath: "/tmp/daoflow-restore-download",
    encryptionMode: "none",
    backupType: "volume",
    volumeName: "postgres-volume",
    ...overrides
  };
}

describe("restore execution", () => {
  it("extracts a downloaded volume tarball before reporting restore success", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-restore-test-"));
    const downloadPath = join(root, "download");
    const targetPath = join(root, "target");
    mkdirSync(downloadPath);
    writeFileSync(join(downloadPath, "backup.tar"), "archive");

    const execFileSyncMock = vi
      .spyOn(processRunner, "execFileSync")
      .mockImplementation(() => "" as never);

    const result = await executeRestoreArtifact(
      restoreContext({ downloadPath, targetPath }),
      downloadPath
    );

    expect(result.success).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "tar",
      ["-xf", join(downloadPath, "backup.tar"), "-C", targetPath],
      expect.objectContaining({ timeout: 300_000 })
    );
  });

  it("builds a postgres restore command that replays the dump through pg_restore", () => {
    const command = restoreDatabaseTestHooks.buildRestoreCommand(
      restoreContext({
        backupType: "database",
        databaseEngine: "postgres",
        databaseName: "app",
        databaseUser: "app_user",
        databasePassword: "secret"
      }),
      "postgres"
    );

    expect(command.envArgs).toEqual(["-e", "PGPASSWORD=secret"]);
    expect(command.args).toEqual([
      "pg_restore",
      "-U",
      "app_user",
      "-d",
      "app",
      "--clean",
      "--if-exists",
      "--no-owner"
    ]);
  });
});
