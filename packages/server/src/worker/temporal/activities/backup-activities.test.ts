import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeBackupCopy, type BackupPolicyResolved } from "./backup-activities";
import { backupCopyActivityTestHooks } from "./backup-copy-activity";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock
}));

const destinationOperationMocks = vi.hoisted(() => ({
  decryptDestinationForVolumeOperation: vi.fn()
}));
const remoteVolumeTransferMocks = vi.hoisted(() => ({
  stageRemoteVolumeBackup: vi.fn()
}));
const rcloneMocks = vi.hoisted(() => ({
  copyToRemoteAsync: vi.fn(),
  listRemoteAsync: vi.fn()
}));

vi.mock("./destination-operation", () => destinationOperationMocks);
vi.mock("./remote-volume-transfer", () => remoteVolumeTransferMocks);
vi.mock("../../rclone-executor", async () => {
  const actual =
    await vi.importActual<typeof import("../../rclone-executor")>("../../rclone-executor");
  return { ...actual, ...rcloneMocks };
});

beforeEach(() => {
  rcloneMocks.copyToRemoteAsync.mockResolvedValue({ success: true, output: "", exitCode: 0 });
  rcloneMocks.listRemoteAsync.mockResolvedValue({ success: true, output: "", exitCode: 0 });
  spawnMock.mockImplementation(() => createSuccessfulChild());
});

afterEach(() => {
  vi.restoreAllMocks();
  destinationOperationMocks.decryptDestinationForVolumeOperation.mockReset();
  remoteVolumeTransferMocks.stageRemoteVolumeBackup.mockReset();
  rcloneMocks.copyToRemoteAsync.mockReset();
  rcloneMocks.listRemoteAsync.mockReset();
  spawnMock.mockReset();
});

function backupPolicyFixture(overrides: Partial<BackupPolicyResolved> = {}): BackupPolicyResolved {
  return {
    policyId: "bpol_test",
    teamId: "team_test",
    policyName: "postgres-policy",
    volumeId: "vol_test",
    volumeName: "postgres-volume",
    mountPath: "/var/lib/postgresql/data",
    sourceKind: "docker-volume",
    serverId: "srv_test",
    serverName: "test-server",
    serverHost: "10.0.0.1",
    retentionDays: 7,
    backupType: "database",
    databaseEngine: "postgres",
    turnOff: false,
    retentionDaily: 7,
    retentionWeekly: 4,
    retentionMonthly: 12,
    maxBackups: 100,
    destinationId: "dest_test",
    ...overrides
  };
}

function createChild(): { child: ChildProcess; kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as ChildProcess;
  const kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  });
  Object.assign(child, { stderr: new PassThrough(), kill });
  return { child, kill };
}

function createSuccessfulChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stderr: new PassThrough(), kill: vi.fn(() => true) });
  queueMicrotask(() => child.emit("close", 0, null));
  return child;
}

describe("executeBackupCopy", () => {
  it("uses an async Docker staging process and propagates cancellation", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-local-volume-stage-"));
    const { child, kill } = createChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const cancellation = new Error("cancel local volume staging");

    try {
      const operation = backupCopyActivityTestHooks.stageDockerVolume(
        "postgres-volume",
        root,
        controller.signal
      );
      await vi.waitFor(() =>
        expect(spawnMock).toHaveBeenCalledWith("docker", expect.any(Array), expect.any(Object))
      );
      controller.abort(cancellation);

      await expect(operation).rejects.toBe(cancellation);
      expect(kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses a staged remote volume archive and cleans its local transfer staging", async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), "daoflow-remote-backup-test-"));
    const archivePath = join(stagingDir, "volume.tar");
    writeFileSync(archivePath, "remote archive");
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups"
    });
    remoteVolumeTransferMocks.stageRemoteVolumeBackup.mockResolvedValue({
      archivePath,
      localStagingDir: stagingDir
    });
    await executeBackupCopy(backupPolicyFixture(), "brun_remote_volume");

    expect(remoteVolumeTransferMocks.stageRemoteVolumeBackup).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv_test", teamId: "team_test" }),
      "brun_remote_volume"
    );
    expect(rcloneMocks.copyToRemoteAsync).toHaveBeenCalledWith(
      expect.any(Object),
      archivePath,
      expect.any(String),
      expect.objectContaining({ cancellationSignal: undefined })
    );
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("keeps local-host volume backups on the existing local path", async () => {
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups"
    });
    await executeBackupCopy(
      backupPolicyFixture({
        serverHost: "127.0.0.1",
        mountPath: tmpdir(),
        sourceKind: "bind-mount"
      }),
      "brun_local_volume"
    );

    expect(remoteVolumeTransferMocks.stageRemoteVolumeBackup).not.toHaveBeenCalled();
    expect(rcloneMocks.copyToRemoteAsync).toHaveBeenCalledWith(
      expect.any(Object),
      tmpdir(),
      expect.any(String),
      expect.any(Object)
    );
  });

  it("uploads the explicit backup source instead of always copying the mounted volume", async () => {
    const destinationSecret = "submitted-backup-destination-secret";
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionPassword: destinationSecret
    });
    const payload = backupPolicyFixture();

    await executeBackupCopy(payload, "brun_test", "/tmp/daoflow-dumps/db.dump");

    expect(rcloneMocks.copyToRemoteAsync).toHaveBeenCalledWith(
      expect.any(Object),
      "/tmp/daoflow-dumps/db.dump",
      expect.any(String),
      expect.any(Object)
    );
    expect(destinationOperationMocks.decryptDestinationForVolumeOperation).toHaveBeenCalledWith({
      volumeId: "vol_test",
      destinationId: "dest_test"
    });
    expect(JSON.stringify(payload)).not.toContain(destinationSecret);
  });

  it("encrypts archive-mode backups before uploading them", async () => {
    const encryptionPassword = "archive-password-never-in-history";
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionMode: "archive-7z",
      encryptionPassword
    });
    const payload = backupPolicyFixture();

    await executeBackupCopy(payload, "brun_encrypted", "/tmp/daoflow-dumps/db.dump");

    const archiveCall = spawnMock.mock.calls.find(([command]) => command === "7z");
    expect(archiveCall?.[1]).toContain(`-p${encryptionPassword}`);
    expect(archiveCall?.[1]).toContain("/tmp/daoflow-dumps/db.dump");

    const copyArgs = rcloneMocks.copyToRemoteAsync.mock.calls[0] ?? [];
    expect(copyArgs).not.toContain("/tmp/daoflow-dumps/db.dump");
    expect(copyArgs.some((value) => typeof value === "string" && value.endsWith(".7z"))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(encryptionPassword);
  });

  it("refuses archive-mode backups without an encryption password", async () => {
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionMode: "archive-zip"
    });
    await expect(
      executeBackupCopy(backupPolicyFixture(), "brun_missing_password", "/tmp/source")
    ).rejects.toThrow("Archive encryption requires a destination encryption password.");
    expect(rcloneMocks.copyToRemoteAsync).not.toHaveBeenCalled();
  });

  it("archives volume contents at the archive root for compatible restores", async () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), "daoflow-archive-root-test-"));
    writeFileSync(join(sourceDirectory, "volume-data.txt"), "backup payload");
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionMode: "archive-zip",
      encryptionPassword: "volume-archive-password"
    });
    try {
      await executeBackupCopy(backupPolicyFixture(), "brun_volume_archive", sourceDirectory);

      const archiveCall = spawnMock.mock.calls.find(([command]) => command === "7z");
      expect(archiveCall?.[1]).toContain(".");
      expect(archiveCall?.[1]).not.toContain(sourceDirectory);
      expect(archiveCall?.[2]).toMatchObject({ cwd: sourceDirectory });
    } finally {
      rmSync(sourceDirectory, { recursive: true, force: true });
    }
  });

  it("preserves a frozen cancellation reason when sensitive cleanup also fails", () => {
    const originalCause = new Error("workflow cancellation cause");
    const cancellation = Object.freeze(new Error("backup cancellation", { cause: originalCause }));
    const controller = new AbortController();
    controller.abort(cancellation);

    const result = backupCopyActivityTestHooks.cancellationWithCleanup(controller.signal, [
      new Error("could not remove staging")
    ]);

    expect(result).not.toBe(cancellation);
    expect(result.message).toContain("backup cancellation Cleanup also failed");
    expect(cancellation.message).toBe("backup cancellation");
    expect(cancellation.cause).toBe(originalCause);
    expect(result.cause).toBeInstanceOf(AggregateError);
    expect((result.cause as AggregateError).errors).toContain(cancellation);
  });
});
