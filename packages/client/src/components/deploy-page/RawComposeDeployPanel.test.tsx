// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RawComposeDeployPanel } from "./RawComposeDeployPanel";

const { infrastructureInventoryUseQueryMock, composeDeploymentPlanUseQueryMock, navigateMock } =
  vi.hoisted(() => ({
    infrastructureInventoryUseQueryMock: vi.fn(),
    composeDeploymentPlanUseQueryMock: vi.fn(),
    navigateMock: vi.fn()
  }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    infrastructureInventory: {
      useQuery: infrastructureInventoryUseQueryMock
    },
    composeDeploymentPlan: {
      useQuery: composeDeploymentPlanUseQueryMock
    }
  }
}));

describe("RawComposeDeployPanel", () => {
  const originalFetch = window.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  function renderPanel(initialEntry = "/deploy?source=compose") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <RawComposeDeployPanel />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [
          {
            id: "srv_1",
            name: "foundation",
            host: "203.0.113.10",
            targetKind: "docker-engine"
          }
        ]
      },
      isLoading: false
    });
    composeDeploymentPlanUseQueryMock.mockReturnValue({
      data: {
        project: { name: "Console", action: "reuse" },
        environment: { name: "production", action: "reuse" },
        service: { name: "app", action: "create" },
        target: {
          serverName: "foundation",
          serverHost: "203.0.113.10",
          targetKind: "docker-engine"
        },
        preflightChecks: [{ status: "ok", detail: "Server is reachable." }],
        steps: ["Stage compose deployment", "Queue execution handoff"],
        executeCommand: "daoflow compose deploy"
      },
      isLoading: false,
      error: null
    });
    fetchMock = vi.fn();
    window.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    window.fetch = originalFetch;
  });

  it("locks onboarding target context and requires preview before apply", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          deploymentId: "dep_compose_1",
          projectId: "proj_console",
          environmentId: "env_prod",
          serviceId: "svc_app"
        })
    });

    renderPanel(
      "/deploy?source=compose&serverId=srv_1&serverName=foundation&projectId=proj_console&projectName=Console&environmentName=production"
    );

    expect(screen.getByTestId("raw-compose-handoff-summary")).toHaveTextContent(
      "Deploying into Console / production on foundation."
    );
    expect(screen.getByTestId("raw-compose-project-name")).toBeDisabled();
    expect(screen.getByTestId("raw-compose-environment-name")).toBeDisabled();
    expect(screen.getByTestId("raw-compose-apply-button")).toBeDisabled();

    fireEvent.click(screen.getByTestId("raw-compose-preview-button"));

    expect(await screen.findByTestId("compose-preview-plan")).toBeVisible();
    expect(screen.getByTestId("raw-compose-apply-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("raw-compose-apply-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    const payload = JSON.parse(request.body as string) as {
      server: string;
      project: string;
      environment: string;
    };

    expect(payload).toMatchObject({
      server: "srv_1",
      project: "proj_console",
      environment: "production"
    });
  });
});
