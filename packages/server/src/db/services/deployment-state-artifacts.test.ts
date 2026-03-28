import { describe, expect, it } from "vitest";
import { buildDeploymentStateArtifacts } from "./deployment-state-artifacts";

describe("buildDeploymentStateArtifacts", () => {
  it("falls back to a single composeFilePath for older deployment snapshots", () => {
    const artifacts = buildDeploymentStateArtifacts({
      deployment: {
        sourceType: "compose",
        serviceName: "api",
        configSnapshot: {
          branch: "main",
          composeFilePath: "docker-compose.yml"
        }
      }
    });

    expect(artifacts.declaredConfig.composeFiles).toEqual(["docker-compose.yml"]);
    expect(artifacts.effectiveDeployment.replayableSnapshot).toMatchObject({
      branch: "main",
      composeFilePath: "docker-compose.yml"
    });
  });

  it("maps live runtime drift details from the environment record", () => {
    const artifacts = buildDeploymentStateArtifacts({
      deployment: {
        sourceType: "compose",
        serviceName: "api",
        configSnapshot: {}
      },
      service: {
        name: "api",
        sourceType: "compose",
        composeServiceName: "api"
      },
      environment: {
        config: {
          composeDriftReports: [
            {
              serviceName: "api",
              status: "drifted",
              summary: "Runtime image drift detected.",
              lastCheckedAt: "2026-03-28T20:00:00.000Z",
              actualContainerState: "running-with-warnings",
              desiredImageReference: "ghcr.io/daoflow/api:sha-123",
              actualImageReference: "ghcr.io/daoflow/api:sha-122",
              desiredReplicaCount: 1,
              actualReplicaCount: 1,
              impactSummary: "One service is still on the previous image.",
              recommendedActions: ["Re-run the deployment after verifying image availability."],
              diffs: [
                {
                  field: "image",
                  desiredValue: "sha-123",
                  actualValue: "sha-122",
                  impact: "Traffic is still served by the previous image."
                }
              ]
            }
          ]
        }
      }
    });

    expect(artifacts.liveRuntime).toMatchObject({
      status: "drifted",
      statusLabel: "Review required",
      statusTone: "running",
      summary: "Runtime image drift detected.",
      actualContainerState: "running-with-warnings",
      desiredImageReference: "ghcr.io/daoflow/api:sha-123",
      actualImageReference: "ghcr.io/daoflow/api:sha-122",
      impactSummary: "One service is still on the previous image.",
      recommendedActions: ["Re-run the deployment after verifying image availability."]
    });
    expect(artifacts.liveRuntime?.diffs).toEqual([
      {
        field: "image",
        desiredValue: "sha-123",
        actualValue: "sha-122",
        impact: "Traffic is still served by the previous image."
      }
    ]);
  });
});
