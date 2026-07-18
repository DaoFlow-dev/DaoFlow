import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const deployment = { id: "dep_activity_heartbeat" };
  const heartbeat = vi.fn();
  const limit = vi.fn();

  return {
    claimDeploymentForExecution: vi.fn(),
    claimNextQueuedDeploymentForExecution: vi.fn(),
    cleanupStagingDir: vi.fn(),
    currentActivityContext: vi.fn(),
    deployment,
    heartbeat,
    limit,
    runDeployment: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit }))
      }))
    }))
  };
});

vi.mock("@temporalio/activity", () => ({
  Context: { current: mocks.currentActivityContext }
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

vi.mock("../../../db/connection", () => ({
  db: { select: mocks.select }
}));

vi.mock("../../../db/schema/deployments", () => ({
  deployments: { id: "id" }
}));

vi.mock("../../docker-executor", () => ({
  cleanupStagingDir: mocks.cleanupStagingDir
}));

vi.mock("../../run-deployment", () => ({
  runDeployment: mocks.runDeployment
}));

vi.mock("../../../db/services/deployment-execution-control", () => ({
  claimDeploymentForExecution: mocks.claimDeploymentForExecution,
  claimNextQueuedDeploymentForExecution: mocks.claimNextQueuedDeploymentForExecution
}));

import { runDeploymentActivity } from "./deploy-activities";

describe("runDeploymentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue([mocks.deployment]);
    mocks.currentActivityContext.mockReturnValue({
      cancellationSignal: new AbortController().signal,
      heartbeat: mocks.heartbeat
    });
    mocks.runDeployment.mockResolvedValue("succeeded");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("heartbeats while running and passes Temporal cancellation to the deployment runner", async () => {
    vi.useFakeTimers();
    const cancellationSignal = new AbortController().signal;
    mocks.currentActivityContext.mockReturnValue({
      cancellationSignal,
      heartbeat: mocks.heartbeat
    });

    let startRun!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      startRun = resolve;
    });
    let finishRun!: (outcome: "succeeded" | "cancelled") => void;
    mocks.runDeployment.mockImplementation(
      () =>
        new Promise<"succeeded" | "cancelled">((resolve) => {
          startRun();
          finishRun = resolve;
        })
    );

    const result = runDeploymentActivity({ id: mocks.deployment.id } as never);
    await runStarted;

    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
    expect(mocks.runDeployment).toHaveBeenCalledWith(
      mocks.deployment,
      "temporal-worker",
      cancellationSignal
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);

    finishRun("succeeded");
    await expect(result).resolves.toBe("succeeded");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  });
});
