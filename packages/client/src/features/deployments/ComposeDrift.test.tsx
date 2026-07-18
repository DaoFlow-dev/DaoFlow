// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComposeDrift } from "./ComposeDrift";

describe("ComposeDrift", () => {
  it("makes cached snapshots visibly non-authoritative and never calls them aligned", () => {
    render(
      <ComposeDrift
        session={{ data: { user: { id: "user_1" } } }}
        composeDriftMessage={null}
        composeDriftReport={{
          data: {
            inspection: {
              availability: "not-implemented",
              blockers: ["#230 strict SSH host identity", "#233 DaoFlow-owned resource selection"],
              limits: { minimumIntervalSeconds: 60, maxConcurrentPerServer: 1 }
            },
            summary: {
              totalServices: 1,
              cachedSnapshotServices: 1,
              unavailableServices: 0,
              reviewRequired: 1,
              blockedServices: 0
            },
            reports: [
              {
                composeServiceId: "compose_api",
                environmentId: "env_prod",
                environmentName: "production",
                projectId: "proj_api",
                projectName: "API",
                serviceName: "api",
                composeFilePath: "/srv/api/compose.yaml",
                target: {
                  serverId: "srv_1",
                  serverName: "edge-1",
                  composeProjectName: "api"
                },
                source: "cached-snapshot",
                authoritative: false,
                attemptedAt: "2026-07-18T10:00:00.000Z",
                observedAt: "2026-07-18T10:00:00.000Z",
                maxAgeSeconds: 900,
                evidenceRefs: [],
                status: "unavailable",
                statusLabel: "Cached snapshot cannot confirm alignment",
                statusTone: "running",
                summary:
                  "A cached snapshot exists, but it cannot verify current runtime alignment.",
                impactSummary: null,
                desiredImageReference: "ghcr.io/example/api:stable",
                actualImageReference: "ghcr.io/example/api:stable",
                desiredReplicaCount: 1,
                actualReplicaCount: 1,
                actualContainerState: "running",
                diffs: [],
                recommendedActions: ["Wait for live inspection support."]
              }
            ]
          }
        }}
      />
    );

    expect(screen.getByTestId("compose-drift-containment-notice")).toHaveTextContent(
      /non-authoritative/i
    );
    expect(screen.getByTestId("compose-drift-authority-compose_api")).toHaveTextContent(
      "Source: cached-snapshot · Authoritative: no"
    );
    expect(screen.getByText("Cached snapshot cannot confirm alignment")).toBeVisible();
    expect(screen.queryByText(/^Aligned$/i)).not.toBeInTheDocument();
  });
});
