import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDeploymentActiveForBuild: vi.fn(),
  markDeploymentBuildSlotAcquired: vi.fn(),
  markDeploymentWaitingForBuildSlot: vi.fn(),
  releaseDeploymentBuildLease: vi.fn(),
  renewDeploymentBuildLease: vi.fn(),
  throwIfDeploymentCancellationRequested: vi.fn(),
  tryAcquireDeploymentBuildLease: vi.fn()
}));

vi.mock("../db/services/deployment-build-capacity", () => ({
  DEFAULT_BUILD_LEASE_DURATION_MS: 120_000,
  isDeploymentActiveForBuild: mocks.isDeploymentActiveForBuild,
  markDeploymentBuildSlotAcquired: mocks.markDeploymentBuildSlotAcquired,
  markDeploymentWaitingForBuildSlot: mocks.markDeploymentWaitingForBuildSlot,
  releaseDeploymentBuildLease: mocks.releaseDeploymentBuildLease,
  renewDeploymentBuildLease: mocks.renewDeploymentBuildLease,
  tryAcquireDeploymentBuildLease: mocks.tryAcquireDeploymentBuildLease
}));

vi.mock("../db/services/deployment-execution-control", () => ({
  throwIfDeploymentCancellationRequested: mocks.throwIfDeploymentCancellationRequested
}));

describe("withDeploymentBuildLease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDeploymentActiveForBuild.mockResolvedValue(true);
    mocks.markDeploymentBuildSlotAcquired.mockResolvedValue(undefined);
    mocks.markDeploymentWaitingForBuildSlot.mockResolvedValue(undefined);
    mocks.releaseDeploymentBuildLease.mockResolvedValue(undefined);
    mocks.renewDeploymentBuildLease.mockResolvedValue(true);
    mocks.throwIfDeploymentCancellationRequested.mockResolvedValue(undefined);
    mocks.tryAcquireDeploymentBuildLease.mockResolvedValue({
      status: "acquired",
      capacity: 1,
      activeLeaseCount: 1,
      renewed: false
    });
  });

  it("forwards an external cancellation that arrives after the build slot is acquired", async () => {
    const { withDeploymentBuildLease } = await import("./deployment-build-lease");
    const external = new AbortController();
    let buildSignal: AbortSignal | undefined;

    const build = withDeploymentBuildLease({
      deploymentId: "dep_cancel_after_acquire",
      serverId: "srv_local",
      onLog: vi.fn(),
      signal: external.signal,
      heartbeatIntervalMs: 60_000,
      leaseDurationMs: 120_000,
      run: async (signal) => {
        buildSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Deployment build cancelled.")
              ),
            { once: true }
          );
        });
      }
    });

    await vi.waitFor(() => expect(buildSignal).toBeDefined());
    external.abort(new Error("Temporal activity cancelled"));

    await expect(build).rejects.toThrow("Temporal activity cancelled");
    expect(buildSignal?.aborted).toBe(true);
    expect(mocks.releaseDeploymentBuildLease).toHaveBeenCalledWith({
      deploymentId: "dep_cancel_after_acquire",
      serverId: "srv_local",
      ownerToken: expect.any(String) as string
    });
  });
});
