import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { copyFromRemoteAsyncMock, decryptDestinationMock } = vi.hoisted(() => ({
  copyFromRemoteAsyncMock: vi.fn(),
  decryptDestinationMock: vi.fn()
}));

vi.mock("../../rclone-executor", async () => {
  const actual =
    await vi.importActual<typeof import("../../rclone-executor")>("../../rclone-executor");
  return {
    ...actual,
    copyFromRemoteAsync: copyFromRemoteAsyncMock
  };
});

vi.mock("./destination-operation", () => ({
  decryptDestinationForVolumeOperation: decryptDestinationMock
}));

import { db } from "../../../db/connection";
import { approvalRequests } from "../../../db/schema/audit";
import { servers } from "../../../db/schema/servers";
import { backupPolicies, backupRuns, volumes } from "../../../db/schema/storage";
import { teams } from "../../../db/schema/teams";
import { resetTestDatabaseWithControlPlane } from "../../../test-db";
import { downloadBackupArtifact, type RestoreResolved } from "./restore-activities";

function suffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

async function createApprovedRestoreFixture() {
  const id = suffix();
  const serverId = `srv_rr_${id}`;
  const volumeId = `vol_rr_${id}`;
  const policyId = `bpol_rr_${id}`;
  const backupRunId = `brun_rr_${id}`;
  const approvalRequestId = `apr_rr_${id}`;
  const now = new Date();

  await db.insert(servers).values({
    id: serverId,
    name: `revalidation-server-${id}`,
    host: `revalidation-server-${id}.test`,
    sshPort: 22,
    kind: "docker-engine",
    status: "ready",
    teamId: "team_foundation",
    metadata: {},
    registeredByUserId: "user_foundation_owner",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(volumes).values({
    id: volumeId,
    name: `revalidation-volume-${id}`,
    serverId,
    mountPath: "/srv/revalidation-test",
    metadata: {},
    createdAt: now,
    updatedAt: now
  });
  await db.insert(backupPolicies).values({
    id: policyId,
    name: `revalidation-policy-${id}`,
    volumeId,
    schedule: "0 * * * *",
    retentionDays: 7,
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(backupRuns).values({
    id: backupRunId,
    policyId,
    status: "succeeded",
    artifactPath: `revalidation-policy-${id}/backup.tar`,
    createdAt: now
  });
  await db.insert(approvalRequests).values({
    id: approvalRequestId,
    teamId: "team_foundation",
    actionType: "backup-restore",
    targetResource: `backup-run/${backupRunId}`,
    status: "approved",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner",
    resolvedByUserId: "user_foundation_owner",
    resolvedByEmail: "owner@daoflow.local",
    createdAt: now,
    resolvedAt: now
  });

  return { backupRunId, approvalRequestId, serverId, volumeId };
}

function restoreContext(
  fixture: Awaited<ReturnType<typeof createApprovedRestoreFixture>>
): RestoreResolved {
  return {
    restoreId: `brest_${fixture.backupRunId}`,
    runId: fixture.backupRunId,
    artifactPath: "backup.tar",
    destinationId: "dest_restore_revalidation",
    volumeId: fixture.volumeId,
    targetPath: "/srv/revalidation-test",
    downloadPath: "/srv/revalidation-test",
    encryptionMode: "none",
    backupType: "volume",
    volumeName: "revalidation-volume",
    sourceKind: "docker-volume",
    approval: {
      approvalRequestId: fixture.approvalRequestId,
      expectedTeamId: "team_foundation"
    }
  };
}

describe("restore approval revalidation", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    copyFromRemoteAsyncMock.mockReset();
    decryptDestinationMock.mockReset();
    decryptDestinationMock.mockResolvedValue({
      id: "dest_restore_revalidation",
      provider: "local",
      localPath: "/tmp/daoflow-backups"
    });
  });

  it("allows a restore only while the approved team still owns the target", async () => {
    const fixture = await createApprovedRestoreFixture();
    copyFromRemoteAsyncMock.mockResolvedValue({ success: true, output: "", exitCode: 0 });

    await expect(downloadBackupArtifact(restoreContext(fixture))).resolves.toEqual({
      success: true,
      localPath: "/srv/revalidation-test"
    });
    expect(copyFromRemoteAsyncMock).toHaveBeenCalledOnce();
  });

  it("fails closed before downloading when the target changes teams after approval", async () => {
    const fixture = await createApprovedRestoreFixture();
    const otherTeamId = `team_rr_${suffix()}`;
    await db.insert(teams).values({
      id: otherTeamId,
      name: "Restore Revalidation Team",
      slug: `restore-revalidation-${suffix()}`,
      updatedAt: new Date()
    });
    await db.update(servers).set({ teamId: otherTeamId }).where(eq(servers.id, fixture.serverId));

    await expect(downloadBackupArtifact(restoreContext(fixture))).rejects.toThrow(
      "Restore approval team no longer matches the restore target."
    );
    expect(copyFromRemoteAsyncMock).not.toHaveBeenCalled();
  });
});
