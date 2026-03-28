import { describe, expect, it } from "vitest";
import { DeploymentConclusion, DeploymentLifecycleStatus, StatusTone } from "@daoflow/shared";
import { summarizeDeploymentHealth } from "./deployment-read-model";
import { deployments } from "../schema/deployments";

type DeploymentRow = typeof deployments.$inferSelect;

function createDeploymentFixture(overrides?: Partial<DeploymentRow>): DeploymentRow {
  const createdAt = new Date("2026-03-28T12:00:00.000Z");

  return {
    id: "dep_watchdog_1",
    projectId: "proj_1",
    environmentId: "env_1",
    targetServerId: "srv_1",
    serviceName: "api",
    sourceType: "compose",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    imageTag: "ghcr.io/example/api:sha-123",
    configSnapshot: {},
    envVarsEncrypted: null,
    status: DeploymentLifecycleStatus.Failed,
    conclusion: DeploymentConclusion.Failed,
    trigger: "user",
    requestedByUserId: null,
    requestedByEmail: null,
    requestedByRole: null,
    containerId: null,
    error: null,
    createdAt,
    concludedAt: createdAt,
    updatedAt: createdAt,
    ...overrides
  };
}

describe("summarizeDeploymentHealth", () => {
  it("surfaces watchdog failures as stalled with recovery context", () => {
    const deployment = createDeploymentFixture({
      error: {
        code: "DEPLOYMENT_WATCHDOG_TIMEOUT",
        reason: "Deployment progress heartbeat timed out.",
        message: "api stopped reporting progress while deploy.",
        detail: "The deployment stopped producing heartbeat updates."
      }
    });

    const summary = summarizeDeploymentHealth({
      deployment,
      steps: []
    });

    expect(summary).toMatchObject({
      status: "failed",
      statusLabel: "Stalled",
      statusTone: StatusTone.Failed,
      summary: "api stopped reporting progress while deploy.",
      failureAnalysis: "Deployment progress heartbeat timed out.",
      observedAt: "2026-03-28T12:00:00.000Z"
    });
  });
});
