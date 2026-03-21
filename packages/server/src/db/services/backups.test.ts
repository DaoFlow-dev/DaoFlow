import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@daoflow/shared";

const { startOneOffBackupWorkflowMock, getBackupCronStatusMock, isTemporalEnabledMock } =
  vi.hoisted(() => ({
    startOneOffBackupWorkflowMock: vi.fn(),
    getBackupCronStatusMock: vi.fn(),
    isTemporalEnabledMock: vi.fn()
  }));

vi.mock("../../worker", async () => {
  const actual = await vi.importActual<typeof import("../../worker")>("../../worker");
  return {
    ...actual,
    getBackupCronStatus: getBackupCronStatusMock,
    startOneOffBackupWorkflow: startOneOffBackupWorkflowMock
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
import { backupPolicies, backupRuns, volumes } from "../schema/storage";
import { servers } from "../schema/servers";
import { users } from "../schema/users";
import { resetTestDatabase } from "../../test-db";
import { listBackupOverview, triggerBackupRun } from "./backups";

function createFixtureSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

async function createBackupPolicyFixture() {
  const suffix = createFixtureSuffix();
  const userId = `usrbk${suffix}`;
  const serverId = `srvbk${suffix}`;
  const volumeId = `volbk${suffix}`;
  const policyId = `bpolbk${suffix}`;
  const now = new Date("2026-03-21T06:00:00.000Z");

  await db.insert(users).values({
    id: userId,
    email: `${userId}@daoflow.local`,
    name: `Backup Fixture ${suffix}`,
    username: userId,
    emailVerified: true,
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  await db.insert(servers).values({
    id: serverId,
    name: `backup-fixture-${suffix}`,
    host: `backup-fixture-${suffix}.test`,
    sshPort: 22,
    kind: "docker-engine",
    status: "ready",
    metadata: {},
    registeredByUserId: userId,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(volumes).values({
    id: volumeId,
    name: `postgres-volume-${suffix}`,
    serverId,
    mountPath: "/var/lib/postgresql/data",
    status: "active",
    metadata: {
      projectName: "DaoFlow",
      environmentName: "staging"
    },
    createdAt: now,
    updatedAt: now
  });

  await db.insert(backupPolicies).values({
    id: policyId,
    name: `control-plane-db-${suffix}`,
    volumeId,
    backupType: "database",
    databaseEngine: "postgres",
    schedule: "0 * * * *",
    retentionDays: 14,
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  return { userId, policyId };
}

describe("triggerBackupRun", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    getBackupCronStatusMock.mockReset();
    startOneOffBackupWorkflowMock.mockReset();
    isTemporalEnabledMock.mockReset();
    isTemporalEnabledMock.mockReturnValue(true);
    getBackupCronStatusMock.mockResolvedValue(null);
    startOneOffBackupWorkflowMock.mockResolvedValue({
      workflowId: "backup-run-test",
      runId: "temporal-run-test"
    });
  });

  it("queues a stable run record and dispatches the one-off backup through Temporal", async () => {
    const fixture = await createBackupPolicyFixture();
    const run = await triggerBackupRun(
      fixture.policyId,
      fixture.userId,
      `${fixture.userId}@daoflow.local`,
      "owner" as AppRole
    );

    expect(run).toBeTruthy();
    expect(run?.status).toBe("queued");
    expect(run?.policyId).toBe(fixture.policyId);
    expect(run).toHaveProperty("workflowId", "backup-run-test");
    expect(startOneOffBackupWorkflowMock).toHaveBeenCalledWith(
      fixture.policyId,
      fixture.userId,
      run?.id
    );

    const [persisted] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, run!.id))
      .limit(1);

    expect(persisted?.status).toBe("queued");
    expect(persisted?.triggeredByUserId).toBe(fixture.userId);
  });

  it("reports cron workflow status for scheduled policies when Temporal mode is enabled", async () => {
    const fixture = await createBackupPolicyFixture();
    getBackupCronStatusMock.mockResolvedValue({
      status: "RUNNING",
      workflowId: `backup-cron-${fixture.policyId}`
    });

    const overview = await listBackupOverview();
    const policy = overview.policies.find((entry) => entry.id === fixture.policyId);

    expect(policy?.temporalWorkflowId).toBe(`backup-cron-${fixture.policyId}`);
    expect(policy?.temporalWorkflowStatus).toBe("RUNNING");
    expect(getBackupCronStatusMock).toHaveBeenCalledWith(fixture.policyId);
  });
});
