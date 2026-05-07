import { describe, expect, it, vi, afterEach } from "vitest";
import { processRunner } from "../../process-runner";
import { executeBackupCopy, type BackupPolicyResolved } from "./backup-activities";

afterEach(() => {
  vi.restoreAllMocks();
});

function backupPolicyFixture(): BackupPolicyResolved {
  return {
    policyId: "bpol_test",
    policyName: "postgres-policy",
    volumeId: "vol_test",
    volumeName: "postgres-volume",
    mountPath: "/var/lib/postgresql/data",
    serverId: "srv_test",
    serverName: "test-server",
    retentionDays: 7,
    backupType: "database",
    databaseEngine: "postgres",
    turnOff: false,
    retentionDaily: 7,
    retentionWeekly: 4,
    retentionMonthly: 12,
    maxBackups: 100,
    destination: {
      id: "dest_test",
      provider: "local",
      localPath: "/tmp/daoflow-backups"
    }
  };
}

describe("executeBackupCopy", () => {
  it("uploads the explicit backup source instead of always copying the mounted volume", async () => {
    const execFileSyncMock = vi
      .spyOn(processRunner, "execFileSync")
      .mockImplementation(() => "" as never);

    await executeBackupCopy(backupPolicyFixture(), "brun_test", "/tmp/daoflow-dumps/db.dump");

    const copyCall = execFileSyncMock.mock.calls.find(([, args]) => {
      return Array.isArray(args) && args.includes("copy");
    });

    expect(copyCall).toBeDefined();
    expect(copyCall?.[1]).toContain("/tmp/daoflow-dumps/db.dump");
    expect(copyCall?.[1]).not.toContain("/var/lib/postgresql/data");
  });
});
