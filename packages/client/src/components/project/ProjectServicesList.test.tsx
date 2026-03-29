// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("shows guided empty-state actions for a selected environment", () => {
    const onCreateService = vi.fn();

    render(
      <MemoryRouter>
        <ProjectServicesList
          services={[]}
          isLoading={false}
          activeEnv="env_prod"
          activeEnvName="Production"
          onCreateService={onCreateService}
          deployHref="/deploy?source=template&projectId=proj_1&environmentId=env_prod"
        />
      </MemoryRouter>
    );

    expect(screen.getByText("No services in Production yet")).toBeVisible();
    expect(screen.getByTestId("project-services-empty-deploy-link")).toHaveAttribute(
      "href",
      "/deploy?source=template&projectId=proj_1&environmentId=env_prod"
    );

    fireEvent.click(screen.getByTestId("project-services-empty-add"));
    expect(onCreateService).toHaveBeenCalledTimes(1);
  });
});
