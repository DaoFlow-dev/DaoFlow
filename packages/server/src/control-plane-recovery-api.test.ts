import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startControlPlaneRecoveryWorkflowMock } = vi.hoisted(() => ({
  startControlPlaneRecoveryWorkflowMock: vi.fn()
}));

vi.mock("./worker/temporal/client", async () => {
  const actual = await vi.importActual<typeof import("./worker/temporal/client")>(
    "./worker/temporal/client"
  );
  return {
    ...actual,
    startControlPlaneRecoveryWorkflow: startControlPlaneRecoveryWorkflowMock
  };
});

import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { controlPlaneRecoveryBundles } from "./db/schema/control-plane-recovery";
import { backupDestinations } from "./db/schema/destinations";
import { appRouter } from "./router";
import { reconcileQueuedControlPlaneRecoveryBundles } from "./db/services/control-plane-recovery";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { makeSession } from "./testing/request-auth-fixtures";

const destinationId = "dest_recovery_owner";
const recoveryKey = "recovery-key-material-for-focused-api-tests";
const schemaVersion = "d".repeat(64);

function caller(role: string, requestId: string, idempotencyKey?: string) {
  return appRouter.createCaller({
    requestId,
    requestHeaders: idempotencyKey ? new Headers({ "idempotency-key": idempotencyKey }) : undefined,
    session: makeSession(role)
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function createDestination() {
  await db.insert(backupDestinations).values({
    id: destinationId,
    teamId: "team_foundation",
    name: "Recovery test destination",
    provider: "local",
    localPath: "/tmp/daoflow-recovery-test",
    endpoint: "https://access:credential@storage.test/recovery?token=secret",
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

function verificationResult(error?: string) {
  return {
    version: 1 as const,
    success: false,
    databaseSha256: "a".repeat(64),
    bundleSha256: "b".repeat(64),
    sourcePostgresVersion: "17.4",
    verifierImage: `pgvector/pgvector:pg17@sha256:${"c".repeat(64)}`,
    durationMs: 1,
    checks: {
      archive: { status: "passed" as const, detail: "Archive was readable." },
      restore: { status: "failed" as const, detail: "password=should-not-leak" },
      migrations: { status: "skipped" as const, detail: "Not reached." },
      ownership: { status: "skipped" as const, detail: "Not reached." },
      secretDecryptability: { status: "skipped" as const, detail: "Not reached." },
      remoteRoundTrip: { status: "skipped" as const, detail: "Not reached." }
    },
    objectCounts: { teams: 1, users: 1, projects: 1, servers: 1, auditEntries: 1, backupRuns: 1 },
    completedAt: "2026-07-18T00:00:00.000Z",
    ...(error ? { error } : {})
  };
}

describe("control-plane recovery API", () => {
  const originalEnvironment = {
    recoveryKey: process.env.DAOFLOW_RECOVERY_ENCRYPTION_KEY,
    temporalEnabled: process.env.DAOFLOW_ENABLE_TEMPORAL,
    temporalAddress: process.env.TEMPORAL_ADDRESS,
    schemaVersion: process.env.DAOFLOW_SCHEMA_VERSION
  };

  beforeEach(async () => {
    process.env.DAOFLOW_RECOVERY_ENCRYPTION_KEY = recoveryKey;
    process.env.DAOFLOW_ENABLE_TEMPORAL = "true";
    process.env.TEMPORAL_ADDRESS = "temporal.test:7233";
    process.env.DAOFLOW_SCHEMA_VERSION = schemaVersion;
    startControlPlaneRecoveryWorkflowMock.mockReset();
    startControlPlaneRecoveryWorkflowMock.mockImplementation(({ bundleId }: { bundleId: string }) =>
      Promise.resolve({
        workflowId: `control-plane-recovery-${bundleId}`,
        runId: "temporal-run-test"
      })
    );
    await resetTestDatabaseWithControlPlane();
    await createDestination();
  });

  afterEach(() => {
    restoreEnvironment("DAOFLOW_RECOVERY_ENCRYPTION_KEY", originalEnvironment.recoveryKey);
    restoreEnvironment("DAOFLOW_ENABLE_TEMPORAL", originalEnvironment.temporalEnabled);
    restoreEnvironment("TEMPORAL_ADDRESS", originalEnvironment.temporalAddress);
    restoreEnvironment("DAOFLOW_SCHEMA_VERSION", originalEnvironment.schemaVersion);
    vi.restoreAllMocks();
  });

  it("returns an owner-only executable recovery plan with no mutation", async () => {
    const plan = await caller("owner", "recovery-plan").controlPlaneRecoveryPlan({ destinationId });

    expect(plan).toMatchObject({
      isReady: true,
      destinationId,
      objectPrefix: "control-plane-recovery/v1",
      executeCommand: `daoflow backup recovery run --destination ${destinationId} --yes`
    });
    expect(plan.schemaVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.requiredExternalSecrets).toEqual(
      expect.arrayContaining([
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "DAOFLOW_RECOVERY_ENCRYPTION_KEY"
      ])
    );

    const rows = await db.select().from(controlPlaneRecoveryBundles);
    expect(rows).toEqual([]);
  });

  it("blocks recovery safely when migration metadata is unavailable", async () => {
    delete process.env.DAOFLOW_SCHEMA_VERSION;

    const plan = await caller("owner", "recovery-plan-untracked").controlPlaneRecoveryPlan({
      destinationId
    });

    expect(plan).toMatchObject({
      isReady: false,
      status: "blocked",
      schemaVersion: "untracked"
    });
    expect(plan.preflightChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          detail:
            "Database migration metadata is unavailable; recovery cannot prove schema compatibility."
        })
      ])
    );
  });

  it("denies every installation-global recovery procedure to non-owners", async () => {
    const nonOwner = caller("admin", "recovery-non-owner");

    await expect(nonOwner.controlPlaneRecoveryPlan({ destinationId })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
    await expect(nonOwner.controlPlaneRecoveryBundles({ limit: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
    await expect(
      nonOwner.triggerControlPlaneRecoveryBundle({ destinationId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("queues, audits, and dispatches a stable recovery workflow", async () => {
    const bundle = await caller("owner", "recovery-trigger").triggerControlPlaneRecoveryBundle({
      destinationId
    });

    expect(bundle).toMatchObject({
      status: "queued",
      destinationId,
      objectPrefix: `control-plane-recovery/v1/${bundle.id}`
    });
    expect(startControlPlaneRecoveryWorkflowMock).toHaveBeenCalledWith({
      bundleId: bundle.id
    });

    const [stored] = await db
      .select()
      .from(controlPlaneRecoveryBundles)
      .where(eq(controlPlaneRecoveryBundles.id, bundle.id));
    expect(stored).toMatchObject({
      status: "queued",
      temporalWorkflowId: `control-plane-recovery-${bundle.id}`,
      temporalRunId: "temporal-run-test"
    });
    expect(stored?.dispatchedAt).toBeInstanceOf(Date);

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `control-plane-recovery/${bundle.id}`),
          eq(auditEntries.action, "control-plane-recovery.trigger")
        )
      );
    expect(audit).toMatchObject({ permissionScope: "backup:run", outcome: "accepted" });
  });

  it("replays a request idempotently without creating or dispatching another bundle", async () => {
    const idempotencyKey = "recovery-replay-key";
    const first = await caller(
      "owner",
      "recovery-replay-first",
      idempotencyKey
    ).triggerControlPlaneRecoveryBundle({ destinationId });
    const replay = await caller(
      "owner",
      "recovery-replay-second",
      idempotencyKey
    ).triggerControlPlaneRecoveryBundle({ destinationId });

    expect(replay.id).toBe(first.id);
    expect(startControlPlaneRecoveryWorkflowMock).toHaveBeenCalledTimes(1);

    const rows = await db.select().from(controlPlaneRecoveryBundles);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(rows[0]?.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(rows[0]?.idempotencyKey).not.toBe(idempotencyKey);
  });

  it("rejects reuse of an idempotency key for a different destination", async () => {
    const otherDestinationId = "dest_recovery_other";
    await db.insert(backupDestinations).values({
      id: otherDestinationId,
      teamId: "team_foundation",
      name: "Other recovery destination",
      provider: "local",
      localPath: "/tmp/daoflow-recovery-other"
    });
    const owner = caller("owner", "recovery-idempotency-conflict", "reused-recovery-key");

    await owner.triggerControlPlaneRecoveryBundle({ destinationId });
    await expect(
      caller(
        "owner",
        "recovery-idempotency-conflict-replay",
        "reused-recovery-key"
      ).triggerControlPlaneRecoveryBundle({ destinationId: otherDestinationId })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps an undispatched bundle queued so an idempotent retry can repair it", async () => {
    startControlPlaneRecoveryWorkflowMock.mockRejectedValueOnce(new Error("token=must-not-leak"));
    const idempotencyKey = "recovery-dispatch-retry-key";
    const owner = caller("owner", "recovery-dispatch-failure", idempotencyKey);

    await expect(owner.triggerControlPlaneRecoveryBundle({ destinationId })).rejects.toThrow(
      "token=[redacted]"
    );

    const [undispatched] = await db
      .select()
      .from(controlPlaneRecoveryBundles)
      .orderBy(controlPlaneRecoveryBundles.createdAt)
      .limit(1);
    expect(undispatched).toMatchObject({ status: "queued", dispatchedAt: null, error: null });

    const replay = await caller(
      "owner",
      "recovery-dispatch-retry",
      idempotencyKey
    ).triggerControlPlaneRecoveryBundle({ destinationId });

    expect(replay.id).toBe(undispatched?.id);
    expect(startControlPlaneRecoveryWorkflowMock).toHaveBeenCalledTimes(2);
    const [repaired] = await db
      .select()
      .from(controlPlaneRecoveryBundles)
      .where(eq(controlPlaneRecoveryBundles.id, replay.id));
    expect(repaired).toMatchObject({ status: "queued", temporalRunId: "temporal-run-test" });
    expect(repaired?.dispatchedAt).toBeInstanceOf(Date);
  });

  it("periodically repairs a queued bundle whose initial Temporal handoff failed", async () => {
    startControlPlaneRecoveryWorkflowMock.mockRejectedValueOnce(new Error("temporary outage"));
    await expect(
      caller("owner", "recovery-reconcile").triggerControlPlaneRecoveryBundle({ destinationId })
    ).rejects.toThrow("temporary outage");

    await expect(reconcileQueuedControlPlaneRecoveryBundles()).resolves.toMatchObject({
      eligibleCount: 1,
      dispatchedCount: 1,
      failures: []
    });

    const [repaired] = await db.select().from(controlPlaneRecoveryBundles).limit(1);
    expect(repaired?.dispatchedAt).toBeInstanceOf(Date);
    expect(repaired?.temporalRunId).toBe("temporal-run-test");
  });

  it("keeps list, detail, and metadata responses free of credential material", async () => {
    await db.insert(controlPlaneRecoveryBundles).values({
      id: "rb_safe_output",
      ownerTeamId: "team_foundation",
      destinationId,
      status: "verified",
      appVersion: "0.9.2",
      schemaVersion: "0034_pale_red_ghost",
      keyFingerprint: "f".repeat(64),
      objectPrefix: "control-plane-recovery/v1/rb_safe_output",
      bundleObjectPath: "control-plane-recovery/v1/rb_safe_output/bundle.dfr",
      manifestObjectPath: "control-plane-recovery/v1/rb_safe_output/manifest.json",
      latestManifestObjectPath: "control-plane-recovery/v1/latest.json",
      error: "secret=do-not-return key=also-do-not-return",
      verificationResult: verificationResult("credential=do-not-return"),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const owner = caller("owner", "recovery-safe-output");
    const [list, detail, metadata] = await Promise.all([
      owner.controlPlaneRecoveryBundles({ limit: 10 }),
      owner.controlPlaneRecoveryBundle({ bundleId: "rb_safe_output" }),
      owner.controlPlaneRecoveryBundleMetadata({ bundleId: "rb_safe_output" })
    ]);

    const serialized = JSON.stringify({ list, detail, metadata });
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("also-do-not-return");
    expect(serialized).not.toContain("password=should-not-leak");
    expect(serialized).not.toContain("credentialsEncrypted");
    expect(serialized).not.toContain("access:credential");
    expect(serialized).not.toContain("token=secret");
    expect(detail.status).toBe("failed");
    expect(detail.verification?.checks.restore.detail).toBe("Sensitive execution detail redacted.");
  });
});
