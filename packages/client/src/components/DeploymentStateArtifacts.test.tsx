// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeploymentStateArtifacts } from "./DeploymentStateArtifacts";

describe("DeploymentStateArtifacts", () => {
  it("renders the declared, frozen, and live runtime sections", () => {
    render(
      <DeploymentStateArtifacts
        deploymentId="dep_state_1"
        artifacts={{
          declaredConfig: {
            sourceType: "compose",
            deploymentSource: "git-repository",
            repoFullName: "DaoFlow-dev/example",
            repoUrl: "https://github.com/DaoFlow-dev/example",
            branch: "main",
            composeServiceName: "api",
            composeFiles: ["docker-compose.yml", "deploy/compose.prod.yml"],
            composeProfiles: ["web"],
            stackName: "example-prod",
            targetServerName: "foundation",
            targetServerHost: "203.0.113.24",
            targetServerKind: "docker-engine"
          },
          effectiveDeployment: {
            composeOperation: "up",
            composeEnvBranch: "main",
            readinessProbe: {
              type: "http",
              target: "published-port",
              serviceName: "api",
              port: 3000,
              path: "/health",
              host: "127.0.0.1",
              scheme: "http",
              intervalSeconds: 3,
              timeoutSeconds: 60
            },
            imageOverride: {
              serviceName: "api",
              imageReference: "ghcr.io/daoflow/api:sha-123"
            },
            runtimeConfigPreview: "services:\n  api:\n    restart: unless-stopped\n",
            preview: null,
            composeEnv: {
              status: "queued",
              branch: "main",
              fileName: ".daoflow.compose.env",
              precedence: ["repo-defaults", "environment", "runtime"],
              counts: {
                total: 3,
                repoDefaults: 1,
                environmentVariables: 2,
                runtime: 2,
                build: 1,
                secrets: 1,
                overriddenRepoDefaults: 0
              },
              warnings: [],
              entries: []
            },
            replayableSnapshot: {
              branch: "main",
              composeFilePath: "docker-compose.yml",
              composeFilePaths: ["docker-compose.yml"]
            }
          },
          liveRuntime: {
            status: "drifted",
            statusLabel: "Review required",
            statusTone: "running",
            summary: "Runtime image drift detected.",
            checkedAt: "2026-03-28T20:00:00.000Z",
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
        }}
      />
    );

    expect(screen.getByText("Declared config")).toBeVisible();
    expect(screen.getByText("Frozen deployment input")).toBeVisible();
    expect(screen.getByText("Last observed live state")).toBeVisible();
    expect(
      within(screen.getByTestId("deployment-state-declared-dep_state_1")).getByText(
        /docker-compose\.yml, deploy\/compose\.prod\.yml/i
      )
    ).toBeVisible();
    expect(
      within(screen.getByTestId("deployment-state-effective-dep_state_1")).getByText(
        /Compose env branch: main/i
      )
    ).toBeVisible();
    expect(screen.getByTestId("deployment-state-live-summary-dep_state_1")).toHaveTextContent(
      /Runtime image drift detected/i
    );
    expect(
      within(screen.getByTestId("deployment-state-live-dep_state_1")).getByText(
        "Recommended next steps"
      )
    ).toBeVisible();
    expect(
      within(screen.getByTestId("deployment-state-live-dep_state_1")).getByText(
        /Re-run the deployment after verifying image availability/i
      )
    ).toBeVisible();
    expect(screen.getByTestId("deployment-state-copy-dep_state_1")).toBeVisible();
    expect(screen.getByTestId("deployment-state-download-dep_state_1")).toBeVisible();
  });
});
