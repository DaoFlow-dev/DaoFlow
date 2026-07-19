import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isTemporalEnabledMock, startRestoreWorkflowMock } = vi.hoisted(() => ({
  isTemporalEnabledMock: vi.fn(),
  startRestoreWorkflowMock: vi.fn()
}));

vi.mock("../../worker", async () => {
  const actual = await vi.importActual<typeof import("../../worker")>("../../worker");
  return {
    ...actual,
    startRestoreWorkflow: startRestoreWorkflowMock
  };
});

vi.mock("../../worker/temporal/temporal-config", async () => {
  const actual = await vi.importActual<typeof import("../../worker/temporal/temporal-config")>(
    "../../worker/temporal/temporal-config"
  );
  return {
    ...actual,
    isTemporalEnabled: isTemporalEnabledMock
  };
});

import { db } from "../connection";
import { approvalRequests } from "../schema/audit";
import { backupDestinations } from "../schema/destinations";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { queueBackupRestore } from "./backup-restores";

function suffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

describe("queueBackupRestore approval binding", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    isTemporalEnabledMock.mockReset();
    isTemporalEnabledMock.mockReturnValue(true);
    startRestoreWorkflowMock.mockReset();
    startRestoreWorkflowMock.mockResolvedValue({
      workflowId: "backup-restore-test",
      runId: "temporal-restore-test"
    });
  });

  it("passes the approved request and expected team into the durable workflow input", async () => {
    const id = suffix();
    const volumeId = `vol_rst_${id}`;
    const destinationId = `dst_rst_${id}`;
    const policyId = `bpol_rst_${id}`;
    const backupRunId = `brun_rst_${id}`;
    const approvalRequestId = `apr_rst_${id}`;
    const now = new Date();
    const artifactPath = `restore-policy-${id}/backup.tar`;
    const artifactChecksum = "a".repeat(64);

    await db.insert(backupDestinations).values({
      id: destinationId,
      teamId: "team_foundation",
      name: `restore-destination-${id}`,
      provider: "local",
      localPath: "/tmp/daoflow-restore-test",
      encryptionMode: "none",
      metadata: {},
      createdAt: now,
      updatedAt: now
    });

    await db.insert(volumes).values({
      id: volumeId,
      name: `restore-volume-${id}`,
      serverId: "srv_foundation_1",
      mountPath: "/srv/restore-test",
      metadata: {},
      createdAt: now,
      updatedAt: now
    });
    await db.insert(backupPolicies).values({
      id: policyId,
      name: `restore-policy-${id}`,
      volumeId,
      destinationId,
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
      artifactPath,
      checksum: artifactChecksum,
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

    const operationId = `rst_op_${id}`;
    const approvalSnapshot = {
      backupRunId,
      artifactPath,
      artifactChecksum,
      backupPolicyId: policyId,
      backupPolicyUpdatedAt: now.toISOString(),
      backupDestinationId: destinationId,
      backupDestinationUpdatedAt: now.toISOString(),
      volumeId,
      volumeUpdatedAt: now.toISOString(),
      volumeMountPath: "/srv/restore-test",
      targetServerId: "srv_foundation_1",
      restoreDestination: "/srv/restore-test",
      secretPolicy: "destination-credentials-encrypted"
    };
    await expect(
      queueBackupRestore(backupRunId, "user_foundation_owner", "owner@daoflow.local", "owner", {
        teamId: "team_foundation",
        approvalRequestId,
        operationId,
        preserveDispatchRetry: true,
        approvalSnapshot
      })
    ).resolves.toMatchObject({ id: operationId, status: "queued" });
    await expect(
      queueBackupRestore(backupRunId, "user_foundation_owner", "owner@daoflow.local", "owner", {
        teamId: "team_foundation",
        approvalRequestId,
        operationId,
        preserveDispatchRetry: true,
        approvalSnapshot
      })
    ).resolves.toMatchObject({ id: operationId, status: "queued" });

    const restores = await db
      .select({ id: backupRestores.id })
      .from(backupRestores)
      .where(eq(backupRestores.id, operationId));
    expect(restores).toEqual([{ id: operationId }]);

    expect(startRestoreWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        restoreId: operationId,
        backupRunId,
        approval: {
          approvalRequestId,
          expectedTeamId: "team_foundation",
          snapshot: approvalSnapshot
        }
      })
    );
    expect(startRestoreWorkflowMock).toHaveBeenCalledTimes(2);
  });
});
