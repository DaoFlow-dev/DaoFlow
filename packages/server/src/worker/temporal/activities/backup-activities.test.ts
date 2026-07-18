import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { processRunner } from "../../process-runner";
import { executeBackupCopy, type BackupPolicyResolved } from "./backup-activities";

const destinationOperationMocks = vi.hoisted(() => ({
  decryptDestinationForVolumeOperation: vi.fn()
}));

vi.mock("./destination-operation", () => destinationOperationMocks);

afterEach(() => {
  vi.restoreAllMocks();
  destinationOperationMocks.decryptDestinationForVolumeOperation.mockReset();
});

function backupPolicyFixture(): BackupPolicyResolved {
  return {
    policyId: "bpol_test",
    teamId: "team_test",
    policyName: "postgres-policy",
    volumeId: "vol_test",
    volumeName: "postgres-volume",
    mountPath: "/var/lib/postgresql/data",
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
    destinationId: "dest_test"
  };
}

describe("executeBackupCopy", () => {
  it("uploads the explicit backup source instead of always copying the mounted volume", async () => {
    const destinationSecret = "submitted-backup-destination-secret";
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionPassword: destinationSecret
    });
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");
    const payload = backupPolicyFixture();

    await executeBackupCopy(payload, "brun_test", "/tmp/daoflow-dumps/db.dump");

    const copyCall = execFileSyncMock.mock.calls.find(([, args]) => {
      return Array.isArray(args) && args.includes("copy");
    });

    expect(copyCall).toBeDefined();
    expect(copyCall?.[1]).toContain("/tmp/daoflow-dumps/db.dump");
    expect(copyCall?.[1]).not.toContain("/var/lib/postgresql/data");
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
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");
    const payload = backupPolicyFixture();

    await executeBackupCopy(payload, "brun_encrypted", "/tmp/daoflow-dumps/db.dump");

    const archiveCall = execFileSyncMock.mock.calls.find(([command]) => command === "7z");
    expect(archiveCall?.[1]).toContain(`-p${encryptionPassword}`);
    expect(archiveCall?.[1]).toContain("/tmp/daoflow-dumps/db.dump");

    const copyCall = execFileSyncMock.mock.calls.find(([, args]) => {
      return Array.isArray(args) && args.includes("copy");
    });
    const copyArgs = copyCall?.[1] ?? [];
    expect(copyArgs).not.toContain("/tmp/daoflow-dumps/db.dump");
    expect(copyArgs.some((value) => value.endsWith(".7z"))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(encryptionPassword);
  });

  it("refuses archive-mode backups without an encryption password", async () => {
    destinationOperationMocks.decryptDestinationForVolumeOperation.mockResolvedValue({
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups",
      encryptionMode: "archive-zip"
    });
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");

    await expect(
      executeBackupCopy(backupPolicyFixture(), "brun_missing_password", "/tmp/source")
    ).rejects.toThrow("Archive encryption requires a destination encryption password.");
    expect(
      execFileSyncMock.mock.calls.some(([, args]) => Array.isArray(args) && args.includes("copy"))
    ).toBe(false);
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
    const execFileSyncMock = vi.spyOn(processRunner, "execFileSync").mockImplementation(() => "");

    try {
      await executeBackupCopy(backupPolicyFixture(), "brun_volume_archive", sourceDirectory);

      const archiveCall = execFileSyncMock.mock.calls.find(([command]) => command === "7z");
      expect(archiveCall?.[1]).toContain(".");
      expect(archiveCall?.[1]).not.toContain(sourceDirectory);
      expect(archiveCall?.[2]).toMatchObject({ cwd: sourceDirectory });
    } finally {
      rmSync(sourceDirectory, { recursive: true, force: true });
    }
  });
});
