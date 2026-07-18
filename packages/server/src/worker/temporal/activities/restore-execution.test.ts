import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processRunner } from "../../process-runner";
import {
  executeRestoreArtifact,
  restoreExecutionTestHooks,
  type RestoreExecutionContext
} from "./restore-execution";
import { restoreDatabaseTestHooks } from "./restore-database";

afterEach(() => {
  vi.restoreAllMocks();
});

function restoreContext(overrides: Partial<RestoreExecutionContext> = {}): RestoreExecutionContext {
  return {
    restoreId: "brest_test",
    runId: "brun_test",
    artifactPath: "postgres-policy/2026-05-07",
    destinationId: "dest_test",
    volumeId: "vol_test",
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

    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");

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

  it("decrypts archive-encrypted database dumps before database restore", () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-database-archive-restore-test-"));
    const downloadPath = join(root, "download");
    mkdirSync(downloadPath);
    const archivePath = join(downloadPath, "database-backup.7z");
    writeFileSync(archivePath, "encrypted database archive");
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");

    try {
      const prepared = restoreExecutionTestHooks.prepareDatabaseRestorePath(
        restoreContext({
          backupType: "database",
          encryptionMode: "archive-7z",
          destination: {
            id: "dest_test",
            provider: "local",
            encryptionPassword: "database-archive-password"
          }
        }),
        downloadPath
      );

      expect(prepared).toEqual({ success: true, path: join(downloadPath, "decrypted") });
      expect(execFileSyncMock).toHaveBeenCalledWith(
        "7z",
        [
          "x",
          "-pdatabase-archive-password",
          `-o${join(downloadPath, "decrypted")}`,
          "-y",
          archivePath
        ],
        expect.objectContaining({ timeout: 300_000 })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
