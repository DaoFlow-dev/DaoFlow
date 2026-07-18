import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const claimSpecificDeploymentActivity = vi.fn();
  const cleanupDeploymentStaging = vi.fn();
  const runDeploymentActivity = vi.fn();
  const activityOptions: Array<{
    heartbeatTimeout?: string;
    retry?: { maximumAttempts?: number };
    startToCloseTimeout?: string;
  }> = [];

  return {
    activityOptions,
    claimSpecificDeploymentActivity,
    cleanupDeploymentStaging,
    proxyActivities: vi.fn(
      (options: {
        heartbeatTimeout?: string;
        retry?: { maximumAttempts?: number };
        startToCloseTimeout?: string;
      }) => {
        activityOptions.push(options);
        return options.retry?.maximumAttempts === 1
          ? { runDeploymentActivity }
          : { claimSpecificDeploymentActivity, cleanupDeploymentStaging };
      }
    ),
    runDeploymentActivity,
    sleep: vi.fn()
  };
});

vi.mock("@temporalio/workflow", () => ({
  ApplicationFailure: class ApplicationFailure extends Error {},
  proxyActivities: mocks.proxyActivities,
  sleep: mocks.sleep
}));

import { deploymentWorkflow } from "./deploy-workflow";

describe("deploymentWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimSpecificDeploymentActivity.mockResolvedValue({ status: "claimed" });
    mocks.cleanupDeploymentStaging.mockResolvedValue(undefined);
    mocks.runDeploymentActivity.mockRejectedValue(new Error("build failed"));
  });

  it("configures deployment execution for a long, single-attempt, heartbeating run", async () => {
    await expect(
      deploymentWorkflow({ id: "dep_temporal_single_attempt" } as never)
    ).rejects.toThrow("build failed");

    expect(mocks.runDeploymentActivity).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupDeploymentStaging).toHaveBeenCalledWith("dep_temporal_single_attempt");
    expect(mocks.activityOptions).toContainEqual(
      expect.objectContaining({
        startToCloseTimeout: "26 hours",
        heartbeatTimeout: "1 minute",
        retry: { maximumAttempts: 1 }
      })
    );
  });
});
