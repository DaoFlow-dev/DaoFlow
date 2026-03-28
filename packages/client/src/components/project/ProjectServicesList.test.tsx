// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectServicesList } from "./ProjectServicesList";

describe("ProjectServicesList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the primary reachable endpoint summary on service cards", () => {
    render(
      <MemoryRouter>
        <ProjectServicesList
          services={[
            {
              id: "svc_api",
              name: "api",
              sourceType: "compose",
              imageReference: null,
              composeServiceName: "api",
              dockerfilePath: null,
              status: "healthy",
              statusTone: "healthy",
              runtimeSummary: {
                statusLabel: "Healthy",
                statusTone: "healthy",
                summary: "Serving traffic normally."
              },
              rolloutStrategy: {
                label: "Compose recreate",
                downtimeRisk: "possible"
              },
              latestDeployment: {
                targetServerName: "foundation",
                imageTag: "ghcr.io/example/api:sha-123"
              },
              endpointSummary: {
                statusLabel: "Healthy",
                statusTone: "healthy",
                primaryHref: "https://app.example.com",
                summary: "app.example.com is live through edge-prod.",
                links: [
                  {
                    id: "domain_primary",
                    copyValue: "https://app.example.com",
                    statusLabel: "Healthy",
                    statusTone: "healthy"
                  }
                ]
              }
            }
          ]}
          isLoading={false}
          activeEnv={null}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("https://app.example.com · Healthy")).toBeVisible();
  });
});
