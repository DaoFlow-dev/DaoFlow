import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  resolveExecutionTarget: vi.fn(),
  withPreparedExecutionTarget: vi.fn(),
  scpDownload: vi.fn(),
  scpUpload: vi.fn(),
  execRemote: vi.fn()
}));

vi.mock("../../../db/connection", () => ({
  db: { select: mocks.select }
}));

vi.mock("../../execution-target", () => ({
  resolveExecutionTarget: mocks.resolveExecutionTarget,
  withPreparedExecutionTarget: mocks.withPreparedExecutionTarget
}));

vi.mock("../../ssh-file-transfer", () => ({
  scpDownload: mocks.scpDownload,
  scpUpload: mocks.scpUpload
}));

vi.mock("../../ssh-connection", () => ({
  MAX_REMOTE_COMMAND_TIMEOUT_MS: 600_000,
  execRemote: mocks.execRemote,
  shellQuote: (value: string) => `'${value.replaceAll("'", "'\\\"'\\\"'")}'`
}));

import {
  remoteVolumeTransferTestHooks,
  restoreRemoteVolumeArchive,
  stageRemoteVolumeBackup
} from "./remote-volume-transfer";

const context = {
  serverId: "srv_test",
  teamId: "team_test",
  volumeName: "app-data",
  mountPath: "/srv/app-data",
  sourceKind: "docker-volume" as const
};

const remoteTarget = {
  mode: "remote" as const,
  remoteWorkDir: "/tmp/daoflow-staging/backup_brun_test",
  ssh: {
    serverName: "remote-test",
    host: "203.0.113.20",
    port: 22,
    privateKey: "private-key"
  }
};

function mockServerLookup(): void {
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ id: context.serverId, teamId: context.teamId }])
      })
    })
  });
}

function mockRemoteTarget(): void {
  mocks.resolveExecutionTarget.mockResolvedValue(remoteTarget);
  mocks.withPreparedExecutionTarget.mockImplementation(
    async (target: unknown, run: (prepared: typeof remoteTarget) => Promise<unknown>) =>
      run(target as typeof remoteTarget)
  );
  mocks.execRemote.mockResolvedValue({ exitCode: 0, signal: null });
  mocks.scpDownload.mockResolvedValue({ exitCode: 0, signal: null });
  mocks.scpUpload.mockResolvedValue({ exitCode: 0, signal: null });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("remote volume backup staging", () => {
  it("uses the pinned execution target, retrieves the tar, and removes only its own staging directory", async () => {
    mockServerLookup();
    mockRemoteTarget();

    const stage = await stageRemoteVolumeBackup(context, "brun_test");

    expect(mocks.resolveExecutionTarget).toHaveBeenCalledWith(
      { id: context.serverId, teamId: context.teamId },
      "backup_brun_test",
      context.teamId
    );
    expect(mocks.withPreparedExecutionTarget).toHaveBeenCalledWith(
      remoteTarget,
      expect.any(Function)
    );
    expect(mocks.scpDownload).toHaveBeenCalledWith(
      remoteTarget.ssh,
      "/tmp/daoflow-staging/backup_brun_test/volume-backup/volume.tar",
      expect.stringContaining("daoflow-backup-brun_test-"),
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 600_000 })
    );
    expect(mocks.execRemote).toHaveBeenNthCalledWith(
      1,
      remoteTarget.ssh,
      expect.stringContaining("timeout 600s sh -ceu"),
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 600_000 })
    );
    expect(mocks.execRemote.mock.calls[0]?.[1]).not.toContain("--foreground");
    expect(mocks.execRemote.mock.calls[0]?.[1]).toContain("docker volume inspect --");
    expect(mocks.execRemote.mock.calls[0]?.[1]).toContain("/dest/volume.tar");
    expect(String(mocks.execRemote.mock.calls[0]?.[1])).not.toContain("[ -d");
    expect(mocks.execRemote).toHaveBeenLastCalledWith(
      remoteTarget.ssh,
      expect.stringContaining("rm -rf --"),
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 60_000 })
    );

    if (!stage) throw new Error("expected remote backup staging");
    rmSync(stage.localStagingDir, { recursive: true, force: true });
  });

  it("cleans local and remote staging when archive download fails", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.scpDownload.mockResolvedValue({ exitCode: 1, signal: null });
    await expect(stageRemoteVolumeBackup(context, "brun_download_failure")).rejects.toThrow(
      "Downloading remote volume archive failed with exit code 1."
    );

    expect(mocks.execRemote).toHaveBeenLastCalledWith(
      remoteTarget.ssh,
      expect.stringContaining("rm -rf --"),
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("returns bounded remote diagnostics when archive creation fails", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.execRemote
      .mockImplementationOnce(
        (
          _target: unknown,
          _command: string,
          onLog: (entry: { stream: "stderr"; message: string; timestamp: Date }) => void
        ) => {
          onLog({
            stream: "stderr",
            message: "timeout: unrecognized option: foreground",
            timestamp: new Date()
          });
          return Promise.resolve({ exitCode: 1, signal: null });
        }
      )
      .mockResolvedValueOnce({ exitCode: 0, signal: null });

    await expect(stageRemoteVolumeBackup(context, "brun_remote_failure")).rejects.toThrow(
      "Creating remote volume archive failed with exit code 1. timeout: unrecognized option: foreground"
    );
    expect(mocks.scpDownload).not.toHaveBeenCalled();
  });

  it("fails the backup when plaintext remote staging cannot be removed", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.execRemote
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 1, signal: null });

    await expect(stageRemoteVolumeBackup(context, "brun_cleanup_failure")).rejects.toThrow(
      "Cleaning up remote volume staging failed with exit code 1."
    );
  });

  it("preserves both the archive and cleanup failures", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.execRemote
      .mockResolvedValueOnce({ exitCode: 1, signal: null })
      .mockResolvedValueOnce({ exitCode: 1, signal: null });

    const failure = await stageRemoteVolumeBackup(context, "brun_double_failure").catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Creating remote volume archive")
      }),
      expect.objectContaining({
        message: expect.stringContaining("Cleaning up remote volume staging")
      })
    ]);
  });

  it("rejects unsafe volume identifiers before any SSH operation", async () => {
    await expect(
      stageRemoteVolumeBackup({ ...context, volumeName: "app-data; rm -rf /" }, "brun_test")
    ).rejects.toThrow("unsafe characters");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.execRemote).not.toHaveBeenCalled();
  });
});

describe("remote volume restore staging", () => {
  it("uploads the archive and still cleans its staging directory when restore fails", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.execRemote
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 1, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null });
    const localStagingDir = mkdtempSync(join(tmpdir(), "daoflow-remote-restore-test-"));
    const archivePath = join(localStagingDir, "volume.tar");
    writeFileSync(archivePath, "archive");

    try {
      await expect(restoreRemoteVolumeArchive(context, "brest_test", archivePath)).rejects.toThrow(
        "Restoring remote volume archive failed with exit code 1."
      );
      expect(mocks.scpUpload).toHaveBeenCalledWith(
        remoteTarget.ssh,
        archivePath,
        "/tmp/daoflow-staging/backup_brun_test/volume-restore/volume.tar",
        expect.any(Function),
        expect.objectContaining({ timeoutMs: 600_000 })
      );
      expect(mocks.execRemote.mock.calls[1]?.[1]).toContain("docker volume inspect --");
      expect(mocks.execRemote.mock.calls[1]?.[1]).toContain("tar -xf");
      expect(mocks.execRemote).toHaveBeenLastCalledWith(
        remoteTarget.ssh,
        expect.stringContaining("rm -rf --"),
        expect.any(Function),
        expect.any(Object)
      );
    } finally {
      rmSync(localStagingDir, { recursive: true, force: true });
    }
  });

  it("shell-quotes registered mount paths and rejects traversal", () => {
    const command = remoteVolumeTransferTestHooks.buildRemoteRestoreCommand(
      { ...context, mountPath: "/srv/app data", sourceKind: "bind-mount" },
      "/tmp/daoflow-staging/restore_brest_test",
      "/tmp/daoflow-staging/restore_brest_test/volume.tar"
    );
    expect(command).toContain("test -d '/srv/app data'");
    expect(command).not.toContain("docker volume inspect --");
    expect(() => remoteVolumeTransferTestHooks.assertSafeMountPath("/srv/../etc")).toThrow(
      "unsafe"
    );
  });

  it("does not report success or attempt remote restore after an upload failure", async () => {
    mockServerLookup();
    mockRemoteTarget();
    mocks.scpUpload.mockResolvedValue({ exitCode: 1, signal: null });
    const localStagingDir = mkdtempSync(join(tmpdir(), "daoflow-remote-upload-failure-"));
    const archivePath = join(localStagingDir, "volume.tar");
    writeFileSync(archivePath, "archive");

    try {
      await expect(
        restoreRemoteVolumeArchive(context, "brest_upload_failure", archivePath)
      ).rejects.toThrow("Uploading remote volume archive failed with exit code 1.");
      expect(mocks.execRemote).toHaveBeenCalledTimes(2);
      expect(mocks.execRemote.mock.calls[0]?.[2]).toEqual(expect.any(Function));
      expect(mocks.execRemote.mock.calls[1]?.[1]).toContain("rm -rf --");
    } finally {
      rmSync(localStagingDir, { recursive: true, force: true });
    }
  });
});
