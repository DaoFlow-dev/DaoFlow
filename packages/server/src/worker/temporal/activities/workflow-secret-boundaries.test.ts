import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  resolveTeamScopedDestinationForVolume: vi.fn(),
  decryptDestinationForVolumeOperation: vi.fn(),
  executePostgresRestoreVerification: vi.fn()
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

vi.mock("./destination-operation", () => ({
  decryptDestinationForVolumeOperation: mocks.decryptDestinationForVolumeOperation
}));

vi.mock("./postgres-restore-verification-activity", () => ({
  executePostgresRestoreVerification: mocks.executePostgresRestoreVerification
}));

import { resolveBackupPolicy } from "./backup-policy-resolution";
import { redactActivitySecretValue } from "./activity-secret-redaction";
import {
  cleanupRestoreDownload,
  executeRestore,
  resolveRestoreContext
} from "./restore-activities";

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
  mocks.decryptDestinationForVolumeOperation.mockReset();
  mocks.executePostgresRestoreVerification.mockReset();
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
        serverId: "srv_test",
        metadata: {
          containerName: "postgres",
          databaseName: "app",
          databaseUser: "app_user",
          databasePassword
        }
      }
    ]);
    mockSelectRows([{ id: "srv_test", teamId: "team_test", host: "127.0.0.1" }]);
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
      destinationId: "dest_test",
      serverId: "srv_test",
      teamId: "team_test",
      mountPath: "/var/lib/postgresql/data"
    });
    expect(workflowPayload).not.toHaveProperty("destination");
    expect(workflowPayload).not.toHaveProperty("databasePassword");
    expect(JSON.stringify(workflowPayload)).not.toContain(destinationSecret);
    expect(JSON.stringify(workflowPayload)).not.toContain(databasePassword);
    expect(workflowPayload?.downloadPath).toBe("/tmp/daoflow-restore/brest_test/download");
    expect(workflowPayload?.downloadPath).not.toBe(workflowPayload?.targetPath);
  });

  it("uses worker-local staging for remote volume restores without changing local volume paths", async () => {
    const resolve = async (host: string, restoreId: string) => {
      mockSelectRows([
        {
          id: `brun_${restoreId}`,
          policyId: `bpol_${restoreId}`,
          artifactPath: "nightly/volume.tar",
          status: "succeeded"
        }
      ]);
      mockSelectRows([
        {
          id: `bpol_${restoreId}`,
          volumeId: `vol_${restoreId}`,
          destinationId: "dest_test",
          backupType: "volume"
        }
      ]);
      mockSelectRows([
        {
          id: `vol_${restoreId}`,
          name: "app-data",
          mountPath: "/srv/app-data",
          serverId: `srv_${restoreId}`,
          metadata: {}
        }
      ]);
      mockSelectRows([{ id: `srv_${restoreId}`, teamId: "team_test", host }]);
      mockRestoreUpdate();
      mocks.resolveTeamScopedDestinationForVolume.mockResolvedValue({
        teamId: "team_test",
        destination: { id: "dest_test", encryptionMode: "none" }
      });

      return resolveRestoreContext({
        restoreId,
        backupRunId: `brun_${restoreId}`,
        triggeredBy: "user_test"
      });
    };

    const remote = await resolve("203.0.113.20", "brest_remote");
    expect(remote).toMatchObject({
      serverId: "srv_brest_remote",
      teamId: "team_test",
      serverHost: "203.0.113.20",
      targetPath: "/srv/app-data",
      downloadPath: "/tmp/daoflow-restore/brest_remote/download"
    });

    mocks.select.mockReset();
    mocks.update.mockReset();
    mocks.resolveTeamScopedDestinationForVolume.mockReset();

    const local = await resolve("127.0.0.1", "brest_local");
    expect(local).toMatchObject({
      targetPath: "/srv/app-data",
      downloadPath: "/srv/app-data"
    });
  });

  it("keeps live database identifiers and credentials out of verification workflow history", async () => {
    const livePassword = "live-database-password-never-in-verification-history";
    mockSelectRows([
      {
        id: "brun_verify",
        policyId: "bpol_verify",
        artifactPath: "nightly/postgres.dump",
        status: "succeeded",
        checksum: "a".repeat(64),
        artifactFormat: "postgres-custom",
        databaseEngineVersion: "17.4",
        databaseImageReference: `sha256:${"b".repeat(64)}`
      }
    ]);
    mockSelectRows([
      {
        id: "bpol_verify",
        volumeId: "vol_verify",
        destinationId: "dest_verify",
        backupType: "database",
        databaseEngine: "postgres"
      }
    ]);
    mockSelectRows([
      {
        id: "vol_verify",
        name: "postgres-data",
        mountPath: "/var/lib/postgresql/data",
        serverId: "srv_verify",
        metadata: {
          containerName: "live-postgres",
          databaseName: "production",
          databaseUser: "production_user",
          databasePassword: livePassword
        }
      }
    ]);
    mockSelectRows([{ id: "srv_verify", teamId: "team_test", host: "127.0.0.1" }]);
    mockRestoreUpdate();
    mocks.resolveTeamScopedDestinationForVolume.mockResolvedValue({
      teamId: "team_test",
      destination: {
        id: "dest_verify",
        encryptionMode: "none"
      }
    });

    const workflowPayload = await resolveRestoreContext({
      restoreId: "brest_verify",
      backupRunId: "brun_verify",
      triggeredBy: "user_test",
      mode: "verification"
    });

    expect(workflowPayload).toMatchObject({
      mode: "verification",
      checksum: "a".repeat(64),
      artifactFormat: "postgres-custom",
      databaseEngineVersion: "17.4",
      databaseImageReference: `sha256:${"b".repeat(64)}`
    });
    expect(workflowPayload?.targetPath).toBeUndefined();
    expect(workflowPayload?.containerName).toBeUndefined();
    expect(workflowPayload?.databaseName).toBeUndefined();
    expect(workflowPayload?.databaseUser).toBeUndefined();
    expect(JSON.stringify(workflowPayload)).not.toContain("live-postgres");
    expect(JSON.stringify(workflowPayload)).not.toContain("production_user");
    expect(JSON.stringify(workflowPayload)).not.toContain(livePassword);
  });

  it("executes PostgreSQL verification without loading the live database password", async () => {
    const ctx = {
      restoreId: "brest_verify",
      runId: "brun_verify",
      teamId: "team_foundation",
      artifactPath: "nightly/postgres.dump",
      destinationId: "dest_verify",
      volumeId: "vol_verify",
      mode: "verification" as const,
      downloadPath: "/tmp/daoflow-restore/brest_verify/download",
      encryptionMode: "none",
      backupType: "database",
      volumeName: "postgres-data",
      sourceKind: "docker-volume" as const,
      databaseEngine: "postgres",
      checksum: "a".repeat(64),
      artifactFormat: "postgres-custom",
      databaseEngineVersion: "17.4",
      databaseImageReference: `postgres:17-alpine@sha256:${"b".repeat(64)}`
    };
    const destination = { id: "dest_verify", provider: "local" };
    mocks.decryptDestinationForVolumeOperation.mockResolvedValue(destination);
    mocks.executePostgresRestoreVerification.mockResolvedValue({
      restoreId: ctx.restoreId,
      success: true,
      bytesRestored: 42
    });

    const result = await executeRestore(ctx, { localPath: ctx.downloadPath });

    expect(result.success).toBe(true);
    expect(mocks.executePostgresRestoreVerification).toHaveBeenCalledWith(
      ctx,
      destination,
      ctx.downloadPath
    );
    expect(mocks.select).not.toHaveBeenCalled();
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

  it("reports staged restore cleanup failures", async () => {
    await expect(
      cleanupRestoreDownload({ downloadPath: "/dev/null/restore-download", targetPath: "/target" })
    ).rejects.toThrow();
  });
});
