import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  startOneOffBackupWorkflowMock,
  startRestoreWorkflowMock,
  getBackupCronStatusMock,
  isTemporalEnabledMock
} = vi.hoisted(() => ({
  startOneOffBackupWorkflowMock: vi.fn(),
  startRestoreWorkflowMock: vi.fn(),
  getBackupCronStatusMock: vi.fn(),
  isTemporalEnabledMock: vi.fn()
}));

vi.mock("../../worker", async () => {
  const actual = await vi.importActual<typeof import("../../worker")>("../../worker");
  return {
    ...actual,
    getBackupCronStatus: getBackupCronStatusMock,
    startOneOffBackupWorkflow: startOneOffBackupWorkflowMock,
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
import { auditEntries } from "../schema/audit";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { servers } from "../schema/servers";
import { teams } from "../schema/teams";
import { users } from "../schema/users";
import { resetTestDatabase } from "../../test-db";
import { BackupVerificationEligibilityError } from "./backup-restores";
import { listBackupOverview, queueBackupRestore, triggerBackupRun } from "./backups";

function createFixtureSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

async function createBackupPolicyFixture() {
  const suffix = createFixtureSuffix();
  const userId = `usrbk${suffix}`;
  const teamId = `teambk${suffix}`;
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

  await db.insert(teams).values({
    id: teamId,
    name: `Backup Fixture Team ${suffix}`,
    slug: `backup-fixture-${suffix}`,
    status: "active",
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(servers).values({
    id: serverId,
    name: `backup-fixture-${suffix}`,
    host: `backup-fixture-${suffix}.test`,
    teamId,
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

async function createBackupRunFixture(
  policyId: string,
  overrides: Partial<typeof backupRuns.$inferInsert> = {}
) {
  const runId = `brunbk${createFixtureSuffix()}`;
  await db.insert(backupRuns).values({
    id: runId,
    policyId,
    status: "succeeded",
    artifactPath: "s3://backup-fixture/postgres.dump",
    checksum: "b".repeat(64),
    artifactFormat: "postgres-custom",
    databaseEngineVersion: "17.4",
    databaseImageReference: `postgres:17-alpine@sha256:${"a".repeat(64)}`,
    startedAt: new Date("2026-03-21T06:00:00.000Z"),
    completedAt: new Date("2026-03-21T06:05:00.000Z"),
    createdAt: new Date("2026-03-21T06:00:00.000Z"),
    ...overrides
  });
  return runId;
}

describe("triggerBackupRun", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    getBackupCronStatusMock.mockReset();
    startOneOffBackupWorkflowMock.mockReset();
    startRestoreWorkflowMock.mockReset();
    isTemporalEnabledMock.mockReset();
    isTemporalEnabledMock.mockReturnValue(true);
    getBackupCronStatusMock.mockResolvedValue(null);
    startOneOffBackupWorkflowMock.mockResolvedValue({
      workflowId: "backup-run-test",
      runId: "temporal-run-test"
    });
    startRestoreWorkflowMock.mockResolvedValue({
      workflowId: "restore-workflow-test",
      runId: "restore-run-test"
    });
  });

  it("queues a stable run record and dispatches the one-off backup through Temporal", async () => {
    const fixture = await createBackupPolicyFixture();
    const run = await triggerBackupRun(
      fixture.policyId,
      fixture.userId,
      `${fixture.userId}@daoflow.local`,
      "owner"
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

  it("queues verification only for trusted PostgreSQL metadata and audits the mode", async () => {
    const fixture = await createBackupPolicyFixture();
    const runId = await createBackupRunFixture(fixture.policyId);

    const restore = await queueBackupRestore(
      runId,
      fixture.userId,
      `${fixture.userId}@daoflow.local`,
      "owner",
      { testRestore: true }
    );

    expect(restore).toMatchObject({
      backupRunId: runId,
      mode: "verification",
      targetPath: null,
      status: "queued"
    });
    expect(startOneOffBackupWorkflowMock).not.toHaveBeenCalled();
    expect(startRestoreWorkflowMock).toHaveBeenCalledWith({
      restoreId: restore?.id,
      backupRunId: runId,
      triggeredBy: fixture.userId,
      targetPath: null,
      mode: "verification",
      testRestore: true,
      approval: undefined
    });

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `backup-restore/${restore?.id}`));
    expect(audit?.action).toBe("backup.verify.queue");
    expect(audit?.inputSummary).toContain("Queued verification");
    expect((audit?.metadata as Record<string, unknown> | null)?.detail).toContain(
      "Queued verification"
    );
  });

  it.each([
    ["the artifact format", { artifactFormat: "postgres-sql" }],
    ["the checksum", { checksum: null }],
    ["the source version", { databaseEngineVersion: null }],
    ["the immutable verifier image", { databaseImageReference: null }]
  ])(
    "rejects verification before queueing when %s is missing or invalid",
    async (_label, overrides) => {
      const fixture = await createBackupPolicyFixture();
      const runId = await createBackupRunFixture(fixture.policyId, overrides);

      const restoresBefore = await db
        .select({ id: backupRestores.id })
        .from(backupRestores)
        .where(eq(backupRestores.backupRunId, runId));

      const verification = queueBackupRestore(
        runId,
        fixture.userId,
        `${fixture.userId}@daoflow.local`,
        "owner",
        {
          testRestore: true
        }
      );
      await expect(verification).rejects.toBeInstanceOf(BackupVerificationEligibilityError);
      await expect(verification).rejects.toThrow("Create a new");

      const restoresAfter = await db
        .select({ id: backupRestores.id })
        .from(backupRestores)
        .where(eq(backupRestores.backupRunId, runId));
      expect(restoresAfter).toEqual(restoresBefore);
      expect(startRestoreWorkflowMock).not.toHaveBeenCalled();
    }
  );

  it("keeps ordinary restore queue audit wording separate from verification", async () => {
    const fixture = await createBackupPolicyFixture();
    const runId = await createBackupRunFixture(fixture.policyId, {
      artifactFormat: null,
      databaseEngineVersion: null,
      databaseImageReference: null,
      checksum: null
    });

    const restore = await queueBackupRestore(
      runId,
      fixture.userId,
      `${fixture.userId}@daoflow.local`,
      "owner"
    );

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `backup-restore/${restore?.id}`));
    expect(audit?.action).toBe("backup.restore.queue");
    expect(audit?.inputSummary).toContain("Queued restore");
    expect((audit?.metadata as Record<string, unknown> | null)?.detail).toContain("Queued restore");
  });
});
