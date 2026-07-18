import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  resolveTeamScopedDestinationForVolume: vi.fn()
}));

vi.mock("../../../db/connection", () => ({
  db: {
    select: mocks.select,
    update: mocks.update
  }
}));

vi.mock("../../../db/services/backup-resource-team", () => ({
  resolveTeamScopedDestinationForVolume: mocks.resolveTeamScopedDestinationForVolume
}));

import { resolveBackupPolicy } from "./backup-policy-resolution";
import { redactActivitySecretValue } from "./activity-secret-redaction";
import { cleanupRestoreDownload, resolveRestoreContext } from "./restore-activities";

function mockSelectRows(rows: unknown[]): void {
  mocks.select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows)
      })
    })
  });
}

function mockRestoreUpdate(): void {
  mocks.update.mockReturnValue({
    set: () => ({
      where: () => Promise.resolve()
    })
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.select.mockReset();
  mocks.update.mockReset();
  mocks.resolveTeamScopedDestinationForVolume.mockReset();
});

describe("Temporal backup secret boundaries", () => {
  it("redacts database passwords from activity result errors", () => {
    const databasePassword = "db";
    const resultError = redactActivitySecretValue(
      `database command rejected password ${databasePassword}`,
      databasePassword
    );

    expect(resultError).toBe("database command rejected password [redacted]");
    expect(resultError).not.toContain(databasePassword);
  });

  it("does not return submitted destination or database secrets from policy resolution", async () => {
    const destinationSecret = "submitted-destination-secret-never-in-history";
    const databasePassword = "submitted-database-password-never-in-history";
    mockSelectRows([
      {
        id: "bpol_test",
        status: "active",
        volumeId: "vol_test",
        destinationId: "dest_test",
        name: "nightly",
        retentionDays: 7,
        backupType: "database",
        databaseEngine: "postgres",
        turnOff: 0,
        retentionDaily: 7,
        retentionWeekly: 4,
        retentionMonthly: 12,
        maxBackups: 100
      }
    ]);
    mockSelectRows([
      {
        id: "vol_test",
        name: "postgres-data",
        mountPath: "/var/lib/postgresql/data",
        serverId: "srv_test",
        metadata: {
          databaseName: "app",
          databaseUser: "app_user",
          databasePassword
        }
      }
    ]);
    mockSelectRows([{ id: "srv_test", name: "primary", host: "127.0.0.1" }]);
    mocks.resolveTeamScopedDestinationForVolume.mockResolvedValue({
      teamId: "team_test",
      destination: {
        id: "dest_test",
        accessKey: "submitted-access-key",
        secretAccessKey: destinationSecret,
        oauthToken: "submitted-oauth-token",
        rcloneConfig: "submitted-rclone-config",
        encryptionPassword: destinationSecret
      }
    });

    const workflowPayload = await resolveBackupPolicy("bpol_test");

    expect(workflowPayload).toMatchObject({
      policyId: "bpol_test",
      volumeId: "vol_test",
      destinationId: "dest_test"
    });
    expect(workflowPayload).not.toHaveProperty("destination");
    expect(workflowPayload).not.toHaveProperty("databasePassword");
    expect(JSON.stringify(workflowPayload)).not.toContain(destinationSecret);
    expect(JSON.stringify(workflowPayload)).not.toContain(databasePassword);
  });

  it("does not return submitted destination or database secrets from restore resolution", async () => {
    const destinationSecret = "submitted-restore-destination-secret-never-in-history";
    const databasePassword = "submitted-restore-password-never-in-history";
    mockSelectRows([
      {
        id: "brun_test",
        policyId: "bpol_test",
        artifactPath: "nightly/backup.sql",
        status: "succeeded"
      }
    ]);
    mockSelectRows([
      {
        id: "bpol_test",
        volumeId: "vol_test",
        destinationId: "dest_test",
        backupType: "database",
        databaseEngine: "postgres"
      }
    ]);
    mockSelectRows([
      {
        id: "vol_test",
        name: "postgres-data",
        mountPath: "/var/lib/postgresql/data",
        metadata: {
          containerName: "postgres",
          databaseName: "app",
          databaseUser: "app_user",
          databasePassword
        }
      }
    ]);
    mockRestoreUpdate();
    mocks.resolveTeamScopedDestinationForVolume.mockResolvedValue({
      teamId: "team_test",
      destination: {
        id: "dest_test",
        secretAccessKey: destinationSecret,
        encryptionPassword: destinationSecret,
        encryptionMode: "archive-7z"
      }
    });

    const workflowPayload = await resolveRestoreContext({
      restoreId: "brest_test",
      backupRunId: "brun_test",
      triggeredBy: "user_test"
    });

    expect(workflowPayload).toMatchObject({
      restoreId: "brest_test",
      runId: "brun_test",
      volumeId: "vol_test",
      destinationId: "dest_test"
    });
    expect(workflowPayload).not.toHaveProperty("destination");
    expect(workflowPayload).not.toHaveProperty("databasePassword");
    expect(JSON.stringify(workflowPayload)).not.toContain(destinationSecret);
    expect(JSON.stringify(workflowPayload)).not.toContain(databasePassword);
    expect(workflowPayload?.downloadPath).toBe("/tmp/daoflow-restore/brest_test/download");
    expect(workflowPayload?.downloadPath).not.toBe(workflowPayload?.targetPath);
  });

  it("removes staged restore downloads without deleting the restore target", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-restore-cleanup-test-"));
    const downloadPath = join(root, "download");
    const targetPath = join(root, "target");
    writeFileSync(downloadPath, "encrypted archive");
    writeFileSync(targetPath, "restored application data");

    try {
      await cleanupRestoreDownload({ downloadPath, targetPath });

      expect(existsSync(downloadPath)).toBe(false);
      expect(existsSync(targetPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
