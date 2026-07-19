import { beforeEach, describe, expect, it, vi } from "vitest";

const activities = vi.hoisted(() => ({
  markControlPlaneRecoveryRunning: vi.fn(),
  resolveControlPlaneRecoveryKey: vi.fn(),
  executeControlPlaneRecoveryBundle: vi.fn(),
  markControlPlaneRecoveryVerified: vi.fn(),
  markControlPlaneRecoveryFailed: vi.fn()
}));
const activityProxy = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined
}));

vi.mock("@temporalio/workflow", () => ({
  ActivityCancellationType: { WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED" },
  proxyActivities: (options: Record<string, unknown>) => {
    activityProxy.options = options;
    return activities;
  }
}));

import { controlPlaneRecoveryWorkflow } from "./control-plane-recovery-workflow";

describe("controlPlaneRecoveryWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits for the long activity to acknowledge cancellation", () => {
    expect(activityProxy.options).toMatchObject({
      startToCloseTimeout: "90 minutes",
      heartbeatTimeout: "2 minutes",
      cancellationType: "WAIT_CANCELLATION_COMPLETED"
    });
  });

  it("marks verified only after the strict activity pipeline succeeds", async () => {
    const result = {
      bundleId: "recovery_217",
      keyFingerprint: "a".repeat(64),
      keyRotatedAt: null,
      objectPaths: {
        prefix: "control-plane-recovery/v1/recovery_217",
        bundlePath: "control-plane-recovery/v1/recovery_217/bundle.dfr",
        manifestPath: "control-plane-recovery/v1/recovery_217/manifest.json",
        latestManifestPath: "control-plane-recovery/v1/latest.json"
      },
      manifest: {},
      verificationResult: {},
      bundleChecksum: "b".repeat(64),
      databaseChecksum: "c".repeat(64),
      sizeBytes: 10
    };
    activities.resolveControlPlaneRecoveryKey.mockResolvedValue({
      fingerprint: "a".repeat(64),
      rotatedAt: null
    });
    activities.executeControlPlaneRecoveryBundle.mockResolvedValue(result);

    await expect(controlPlaneRecoveryWorkflow({ bundleId: "recovery_217" })).resolves.toEqual({
      bundleId: "recovery_217",
      status: "verified"
    });
    expect(activities.markControlPlaneRecoveryRunning).toHaveBeenCalledWith("recovery_217");
    expect(activities.markControlPlaneRecoveryVerified).toHaveBeenCalledWith(result);
    expect(activities.markControlPlaneRecoveryFailed).not.toHaveBeenCalled();
  });

  it("records a failed status without exposing the activity error", async () => {
    activities.resolveControlPlaneRecoveryKey.mockRejectedValue(new Error("key material=secret"));

    await expect(controlPlaneRecoveryWorkflow({ bundleId: "recovery_217" })).rejects.toThrow(
      "Control-plane recovery bundle creation failed."
    );
    expect(activities.markControlPlaneRecoveryFailed).toHaveBeenCalledWith(
      "recovery_217",
      expect.any(Error)
    );
    expect(activities.markControlPlaneRecoveryVerified).not.toHaveBeenCalled();
  });
});
