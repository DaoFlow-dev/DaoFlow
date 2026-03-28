import { describe, expect, it } from "vitest";
import { deployments } from "../schema/deployments";
import { buildDeploymentRecoveryGuidance } from "./deployment-recovery-guidance";

function makeDeployment(
  overrides: Partial<typeof deployments.$inferSelect> = {}
): typeof deployments.$inferSelect {
  return {
    id: "dep_recovery_1",
    projectId: "proj_recovery_1",
    environmentId: "env_recovery_1",
    targetServerId: "srv_foundation_1",
    serviceName: "control-plane",
    sourceType: "compose",
    commitSha: null,
    imageTag: null,
    configSnapshot: {},
    envVarsEncrypted: null,
    status: "failed",
    conclusion: "failed",
    trigger: "user",
    requestedByUserId: null,
    requestedByEmail: null,
    requestedByRole: null,
    containerId: null,
    error: null,
    createdAt: new Date("2026-03-28T12:00:00.000Z"),
    concludedAt: new Date("2026-03-28T12:05:00.000Z"),
    updatedAt: new Date("2026-03-28T12:05:00.000Z"),
    ...overrides
  };
}

describe("buildDeploymentRecoveryGuidance", () => {
  it("classifies watchdog timeout failures as watchdog guidance", () => {
    const guidance = buildDeploymentRecoveryGuidance(
      makeDeployment({
        error: {
          code: "DEPLOYMENT_WATCHDOG_TIMEOUT",
          message: "DaoFlow stopped waiting because deployment progress went silent.",
          reason: "Deployment progress heartbeat timed out."
        },
        configSnapshot: {
          insight: {
            safeActions: [
              "Inspect the deployment logs immediately before the stall.",
              "Retry the rollout after the runtime is responsive again."
            ],
            evidence: [
              {
                kind: "watchdog",
                id: "deployment-watchdog-timeout",
                title: "Progress heartbeat timed out",
                detail: "The last recorded deployment heartbeat timed out."
              }
            ]
          }
        }
      })
    );

    expect(guidance).toMatchObject({
      source: "watchdog",
      summary: "DaoFlow stopped waiting because deployment progress went silent.",
      suspectedRootCause: "Deployment progress heartbeat timed out.",
      safeActions: [
        "Inspect the deployment logs immediately before the stall.",
        "Retry the rollout after the runtime is responsive again."
      ]
    });
    expect(guidance?.evidence).toEqual([
      {
        kind: "watchdog",
        id: "deployment-watchdog-timeout",
        title: "Progress heartbeat timed out",
        detail: "The last recorded deployment heartbeat timed out."
      }
    ]);
  });

  it("returns null when the deployment has no structured recovery fields", () => {
    expect(buildDeploymentRecoveryGuidance(makeDeployment())).toBeNull();
  });
});
