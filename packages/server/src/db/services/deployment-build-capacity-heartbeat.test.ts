import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { deploymentBuildLeases } from "../schema/deployments";
import {
  DeploymentBuildLeaseLostError,
  withDeploymentBuildLease
} from "../../worker/deployment-build-lease";
import {
  createLeaseDeployment,
  leaseOptions,
  resetBuildCapacityFixture,
  waitUntil
} from "./deployment-build-capacity.test-support";

describe("deployment build capacity heartbeat", () => {
  beforeEach(async () => {
    await resetBuildCapacityFixture();
  });

  it("aborts the build when heartbeat renewal loses lease ownership", async () => {
    const deploymentId = await createLeaseDeployment("heartbeat-loss");
    const log = vi.fn();
    const build = withDeploymentBuildLease({
      ...leaseOptions(deploymentId),
      ownerToken: "heartbeat-owner",
      heartbeatIntervalMs: 10,
      onLog: log,
      run: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Build aborted after losing its lease.")
              ),
            { once: true }
          );
        })
    });

    await waitUntil(async () => {
      const leases = await db.select().from(deploymentBuildLeases);
      return leases.length === 1;
    });
    await db
      .delete(deploymentBuildLeases)
      .where(eq(deploymentBuildLeases.deploymentId, deploymentId));

    await expect(build).rejects.toBeInstanceOf(DeploymentBuildLeaseLostError);
    expect(
      log.mock.calls.some((call) => {
        const line = call[0] as { message?: unknown } | undefined;
        return String(line?.message).includes("lost ownership");
      })
    ).toBe(true);
  });

  it("aborts before lease expiry when heartbeat renewal stalls", async () => {
    const deploymentId = await createLeaseDeployment("heartbeat-stall");
    const build = withDeploymentBuildLease({
      ...leaseOptions(deploymentId),
      ownerToken: "heartbeat-stall-owner",
      leaseDurationMs: 80,
      heartbeatIntervalMs: 10,
      renewLease: () => new Promise<boolean>(() => undefined),
      run: (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Build aborted before lease expiry.")
              ),
            { once: true }
          );
        })
    });

    await expect(build).rejects.toBeInstanceOf(DeploymentBuildLeaseLostError);
  });
});
