import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { deploymentBuildLeases, deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { withDeploymentBuildLease } from "../../worker/deployment-build-lease";
import {
  releaseDeploymentBuildLease,
  renewDeploymentBuildLease,
  tryAcquireDeploymentBuildLease
} from "./deployment-build-capacity";
import { cancelDeployment } from "./deployments";
import { DeploymentCancellationError } from "../../deployment-cancellation";
import {
  createDeferred,
  createLeaseDeployment,
  leaseOptions,
  resetBuildCapacityFixture,
  waitUntil
} from "./deployment-build-capacity.test-support";

describe("deployment build capacity", () => {
  beforeEach(async () => {
    await resetBuildCapacityFixture();
  });

  it("prevents overlapping build callbacks when the server capacity is one", async () => {
    const firstDeploymentId = await createLeaseDeployment("one-first");
    const secondDeploymentId = await createLeaseDeployment("one-second");
    const firstRelease = createDeferred();
    const secondRelease = createDeferred();
    let activeBuilds = 0;
    let maximumActiveBuilds = 0;
    let secondStarted = false;

    const first = withDeploymentBuildLease({
      ...leaseOptions(firstDeploymentId),
      run: async () => {
        activeBuilds += 1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        await firstRelease.promise;
        activeBuilds -= 1;
      }
    });
    await waitUntil(() => activeBuilds === 1);

    const second = withDeploymentBuildLease({
      ...leaseOptions(secondDeploymentId),
      run: async () => {
        secondStarted = true;
        activeBuilds += 1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        await secondRelease.promise;
        activeBuilds -= 1;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondStarted).toBe(false);
    expect(maximumActiveBuilds).toBe(1);

    firstRelease.resolve();
    await first;
    await waitUntil(() => secondStarted);
    secondRelease.resolve();
    await second;

    expect(maximumActiveBuilds).toBe(1);
  });

  it("allows two concurrent build callbacks when the server capacity is two", async () => {
    await db
      .update(servers)
      .set({ maxConcurrentBuilds: 2 })
      .where(eq(servers.id, "srv_foundation_1"));
    const firstDeploymentId = await createLeaseDeployment("two-first");
    const secondDeploymentId = await createLeaseDeployment("two-second");
    const release = createDeferred();
    let activeBuilds = 0;
    let maximumActiveBuilds = 0;

    const run = () => async () => {
      activeBuilds += 1;
      maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
      await release.promise;
      activeBuilds -= 1;
    };
    const first = withDeploymentBuildLease({ ...leaseOptions(firstDeploymentId), run: run() });
    const second = withDeploymentBuildLease({ ...leaseOptions(secondDeploymentId), run: run() });

    await waitUntil(() => activeBuilds === 2);
    expect(maximumActiveBuilds).toBe(2);

    release.resolve();
    await Promise.all([first, second]);
  });

  it("recovers build capacity from an expired lease", async () => {
    const expiredDeploymentId = await createLeaseDeployment("expired");
    const replacementDeploymentId = await createLeaseDeployment("replacement");
    const expiredAt = new Date(Date.now() - 1_000);
    await db.insert(deploymentBuildLeases).values({
      deploymentId: expiredDeploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "expired-owner",
      acquiredAt: new Date(Date.now() - 2_000),
      heartbeatAt: new Date(Date.now() - 1_500),
      expiresAt: expiredAt
    });

    const result = await tryAcquireDeploymentBuildLease({
      deploymentId: replacementDeploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "replacement-owner"
    });

    expect(result).toMatchObject({ status: "acquired", activeLeaseCount: 1, renewed: false });
    const leases = await db.select().from(deploymentBuildLeases);
    expect(leases).toHaveLength(1);
    expect(leases[0]?.deploymentId).toBe(replacementDeploymentId);
    const [expiredDeployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, expiredDeploymentId));
    expect(expiredDeployment?.status).toBe("failed");
    expect(expiredDeployment?.conclusion).toBe("failed");
  });

  it("admits waiting builds in oldest-first order and reports queue position", async () => {
    const olderDeploymentId = await createLeaseDeployment("fifo-older");
    const newerDeploymentId = await createLeaseDeployment("fifo-newer");
    await db
      .update(deployments)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(deployments.id, olderDeploymentId));
    await db
      .update(deployments)
      .set({ createdAt: new Date("2026-01-01T00:00:01.000Z") })
      .where(eq(deployments.id, newerDeploymentId));

    await expect(
      tryAcquireDeploymentBuildLease({
        deploymentId: newerDeploymentId,
        serverId: "srv_foundation_1",
        ownerToken: "newer-owner"
      })
    ).resolves.toMatchObject({ status: "waiting", queuePosition: 2 });

    await expect(
      tryAcquireDeploymentBuildLease({
        deploymentId: olderDeploymentId,
        serverId: "srv_foundation_1",
        ownerToken: "older-owner"
      })
    ).resolves.toMatchObject({ status: "acquired", activeLeaseCount: 1 });
  });

  it("releases a build lease after both successful and failed build commands", async () => {
    const successfulDeploymentId = await createLeaseDeployment("release-success");
    await expect(
      withDeploymentBuildLease({
        ...leaseOptions(successfulDeploymentId),
        run: () => Promise.resolve("built")
      })
    ).resolves.toBe("built");
    expect(await db.select().from(deploymentBuildLeases)).toHaveLength(0);

    const failedDeploymentId = await createLeaseDeployment("release-failure");
    await expect(
      withDeploymentBuildLease({
        ...leaseOptions(failedDeploymentId),
        run: () => Promise.reject(new Error("build failed"))
      })
    ).rejects.toThrow("build failed");
    expect(await db.select().from(deploymentBuildLeases)).toHaveLength(0);
  });

  it("keeps its lease while a timed-out caller leaves the build command running", async () => {
    const deploymentId = await createLeaseDeployment("timeout");
    const started = createDeferred();
    const release = createDeferred();
    const build = withDeploymentBuildLease({
      ...leaseOptions(deploymentId),
      run: async () => {
        started.resolve();
        return release.promise;
      }
    });

    await started.promise;

    const outerResult = await Promise.race([
      build.then(() => "completed"),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 10))
    ]);
    expect(outerResult).toBe("timed-out");

    await db
      .update(deployments)
      .set({ status: "failed", concludedAt: new Date(), updatedAt: new Date() })
      .where(eq(deployments.id, deploymentId));
    expect(await db.select().from(deploymentBuildLeases)).toHaveLength(1);

    release.resolve();
    await build;
    expect(await db.select().from(deploymentBuildLeases)).toHaveLength(0);
  });

  it("does not start a build after cancellation is requested while waiting", async () => {
    const occupiedDeploymentId = await createLeaseDeployment("occupied");
    const waitingDeploymentId = await createLeaseDeployment("terminal");
    const callback = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const acquired = await tryAcquireDeploymentBuildLease({
      deploymentId: occupiedDeploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "occupied-owner"
    });
    expect(acquired.status).toBe("acquired");

    const waitingBuild = withDeploymentBuildLease({
      ...leaseOptions(waitingDeploymentId),
      onLog: log,
      run: callback
    });
    await waitUntil(() => log.mock.calls.length > 0);

    const cancellation = await cancelDeployment({
      deploymentId: waitingDeploymentId,
      teamId: "team_foundation",
      cancelledByUserId: "user_foundation_owner",
      cancelledByEmail: "owner@daoflow.local",
      cancelledByRole: "owner"
    });
    expect(cancellation.status).toBe("cancelled");

    await expect(waitingBuild).rejects.toBeInstanceOf(DeploymentCancellationError);
    expect(callback).not.toHaveBeenCalled();
    await releaseDeploymentBuildLease({
      deploymentId: occupiedDeploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "occupied-owner"
    });
  });

  it("does not let a second attempt for the same deployment share its live lease", async () => {
    const deploymentId = await createLeaseDeployment("duplicate-attempt");
    const firstRelease = createDeferred();
    const secondRelease = createDeferred();
    let activeBuilds = 0;
    let maximumActiveBuilds = 0;
    let secondStarted = false;

    const first = withDeploymentBuildLease({
      ...leaseOptions(deploymentId),
      ownerToken: "attempt-one",
      run: async () => {
        activeBuilds += 1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        await firstRelease.promise;
        activeBuilds -= 1;
      }
    });
    await waitUntil(() => activeBuilds === 1);

    const second = withDeploymentBuildLease({
      ...leaseOptions(deploymentId),
      ownerToken: "attempt-two",
      run: async () => {
        secondStarted = true;
        activeBuilds += 1;
        maximumActiveBuilds = Math.max(maximumActiveBuilds, activeBuilds);
        await secondRelease.promise;
        activeBuilds -= 1;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondStarted).toBe(false);
    firstRelease.resolve();
    await first;
    await waitUntil(() => secondStarted);
    secondRelease.resolve();
    await second;
    expect(maximumActiveBuilds).toBe(1);
  });

  it("prevents a stale owner from renewing or releasing a replacement lease", async () => {
    const deploymentId = await createLeaseDeployment("stale-owner");
    const first = await tryAcquireDeploymentBuildLease({
      deploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "stale-owner",
      leaseDurationMs: 10
    });
    expect(first.status).toBe("acquired");

    await db
      .update(deploymentBuildLeases)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(deploymentBuildLeases.deploymentId, deploymentId));
    const replacement = await tryAcquireDeploymentBuildLease({
      deploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "replacement-owner"
    });
    expect(replacement.status).toBe("acquired");

    await expect(
      renewDeploymentBuildLease({
        deploymentId,
        serverId: "srv_foundation_1",
        ownerToken: "stale-owner"
      })
    ).resolves.toBe(false);
    await releaseDeploymentBuildLease({
      deploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "stale-owner"
    });

    const [lease] = await db.select().from(deploymentBuildLeases);
    expect(lease?.ownerToken).toBe("replacement-owner");
  });

  it("starts the renewed lease lifetime after a blocking database lock is acquired", async () => {
    const deploymentId = await createLeaseDeployment("delayed-renewal");
    await tryAcquireDeploymentBuildLease({
      deploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "delayed-owner",
      leaseDurationMs: 1_000
    });

    const lockAcquired = createDeferred();
    const releaseLock = createDeferred();
    const lockHolder = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT ${deploymentBuildLeases.deploymentId}
            FROM ${deploymentBuildLeases}
            WHERE ${deploymentBuildLeases.deploymentId} = ${deploymentId}
            FOR UPDATE`
      );
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;

    const renewal = renewDeploymentBuildLease({
      deploymentId,
      serverId: "srv_foundation_1",
      ownerToken: "delayed-owner",
      leaseDurationMs: 500
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    releaseLock.resolve();
    await lockHolder;

    await expect(renewal).resolves.toBe(true);
    const [lease] = await db
      .select()
      .from(deploymentBuildLeases)
      .where(eq(deploymentBuildLeases.deploymentId, deploymentId));
    expect(lease?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 350);
  });
});
