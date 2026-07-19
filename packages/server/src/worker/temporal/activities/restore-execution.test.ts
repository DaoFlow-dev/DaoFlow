import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localCommandMocks = vi.hoisted(() => ({ runCancellableLocalCommand: vi.fn() }));

vi.mock("../../cancellable-local-command", () => localCommandMocks);

const remoteVolumeTransferMocks = vi.hoisted(() => ({
  restoreRemoteVolumeArchive: vi.fn()
}));

vi.mock("./remote-volume-transfer", () => remoteVolumeTransferMocks);

import {
  executeRestoreArtifact,
  restoreExecutionTestHooks,
  type RestoreExecutionContext
} from "./restore-execution";
import { restoreDatabaseTestHooks } from "./restore-database";

beforeEach(() => {
  localCommandMocks.runCancellableLocalCommand.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  remoteVolumeTransferMocks.restoreRemoteVolumeArchive.mockReset();
  localCommandMocks.runCancellableLocalCommand.mockReset();
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
    mode: "restore",
    targetPath: "/tmp/daoflow-restore-target",
    downloadPath: "/tmp/daoflow-restore-download",
    encryptionMode: "none",
    backupType: "volume",
    volumeName: "postgres-volume",
    sourceKind: "docker-volume",
    ...overrides
  };
}

describe("restore execution", () => {
  it("restores a current remote volume through the pinned remote transfer path", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-remote-restore-execution-"));
    const downloadPath = join(root, "download");
    mkdirSync(downloadPath);
    const archivePath = join(downloadPath, "backup.tar");
    writeFileSync(archivePath, "archive");
    remoteVolumeTransferMocks.restoreRemoteVolumeArchive.mockResolvedValue({ bytesRestored: 7 });

    try {
      const result = await executeRestoreArtifact(
        restoreContext({
          downloadPath,
          mode: "restore",
          serverId: "srv_remote",
          teamId: "team_test",
          serverHost: "203.0.113.20",
          mountPath: "/srv/app-data"
        }),
        downloadPath
      );

      expect(result).toEqual({ success: true, bytesRestored: 7 });
      expect(remoteVolumeTransferMocks.restoreRemoteVolumeArchive).toHaveBeenCalledWith(
        {
          serverId: "srv_remote",
          teamId: "team_test",
          volumeName: "postgres-volume",
          mountPath: "/srv/app-data",
          sourceKind: "docker-volume"
        },
        "brest_test",
        archivePath
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts a downloaded volume tarball before reporting restore success", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-restore-test-"));
    const downloadPath = join(root, "download");
    const targetPath = join(root, "target");
    mkdirSync(downloadPath);
    writeFileSync(join(downloadPath, "backup.tar"), "archive");

    const result = await executeRestoreArtifact(
      restoreContext({ downloadPath, targetPath }),
      downloadPath
    );

    expect(result.success).toBe(true);
    expect(localCommandMocks.runCancellableLocalCommand).toHaveBeenCalledWith(
      "tar",
      ["-xf", join(downloadPath, "backup.tar"), "-C", targetPath],
      expect.objectContaining({ timeoutMs: 300_000, signal: undefined })
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
      "--exit-on-error",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges"
    ]);
  });

  it("decrypts archive-encrypted database dumps before database restore", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-database-archive-restore-test-"));
    const downloadPath = join(root, "download");
    mkdirSync(downloadPath);
    const archivePath = join(downloadPath, "database-backup.7z");
    writeFileSync(archivePath, "encrypted database archive");
    try {
      const prepared = await restoreExecutionTestHooks.prepareDatabaseRestorePath(
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
      expect(localCommandMocks.runCancellableLocalCommand).toHaveBeenCalledWith(
        "7z",
        [
          "x",
          "-pdatabase-archive-password",
          `-o${join(downloadPath, "decrypted")}`,
          "-y",
          archivePath
        ],
        expect.objectContaining({ timeoutMs: 300_000, signal: undefined })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates cancellation from local archive extraction", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-local-restore-cancellation-"));
    const downloadPath = join(root, "download");
    const targetPath = join(root, "target");
    mkdirSync(downloadPath);
    writeFileSync(join(downloadPath, "backup.tar"), "archive");
    const controller = new AbortController();
    const cancellation = new Error("cancel local restore extraction");
    controller.abort(cancellation);
    localCommandMocks.runCancellableLocalCommand.mockRejectedValue(cancellation);

    try {
      await expect(
        executeRestoreArtifact(
          restoreContext({ downloadPath, targetPath }),
          downloadPath,
          controller.signal
        )
      ).rejects.toBe(cancellation);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("propagates cancellation into database replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-database-restore-cancellation-"));
    const dumpPath = join(root, "database.dump");
    writeFileSync(dumpPath, "database dump");
    const controller = new AbortController();
    const cancellation = new Error("cancel database replay");
    localCommandMocks.runCancellableLocalCommand.mockImplementation(
      (_command: string, _args: string[], options: { signal?: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              const reason: unknown = options.signal?.reason;
              reject(reason instanceof Error ? reason : cancellation);
            },
            { once: true }
          );
        })
    );

    try {
      const operation = executeRestoreArtifact(
        restoreContext({
          backupType: "database",
          databaseEngine: "postgres",
          databaseName: "app",
          databaseUser: "app_user",
          containerName: "postgres",
          databasePassword: "secret"
        }),
        root,
        controller.signal
      );
      await vi.waitFor(() =>
        expect(localCommandMocks.runCancellableLocalCommand).toHaveBeenCalledWith(
          expect.any(String),
          expect.arrayContaining(["exec", "-i", "postgres"]),
          expect.objectContaining({ signal: controller.signal, stdinFilePath: dumpPath })
        )
      );
      controller.abort(cancellation);

      await expect(operation).rejects.toBe(cancellation);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
