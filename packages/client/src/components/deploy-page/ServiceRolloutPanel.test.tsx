// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRolloutPanel } from "./ServiceRolloutPanel";

const {
  servicesUseQueryMock,
  deploymentPlanUseQueryMock,
  triggerDeployUseMutationMock,
  navigateMock
} = vi.hoisted(() => ({
  servicesUseQueryMock: vi.fn(),
  deploymentPlanUseQueryMock: vi.fn(),
  triggerDeployUseMutationMock: vi.fn(),
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
    services: {
      useQuery: servicesUseQueryMock
    },
    deploymentPlan: {
      useQuery: deploymentPlanUseQueryMock
    },
    triggerDeploy: {
      useMutation: triggerDeployUseMutationMock
    }
  }
}));

describe("ServiceRolloutPanel", () => {
  const triggerDeployMutateMock = vi.fn();

  function renderPanel(initialEntry = "/deploy?source=service") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ServiceRolloutPanel />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    triggerDeployMutateMock.mockReset();

    servicesUseQueryMock.mockReturnValue({
      data: [
        {
          id: "svc_api",
          name: "api",
          projectId: "proj_console",
          projectName: "Console",
          environmentName: "production",
          sourceType: "compose",
          status: "healthy",
          statusTone: "running",
          statusLabel: "Healthy"
        }
      ],
      isLoading: false
    });

    deploymentPlanUseQueryMock.mockReturnValue({
      data: {
        service: {
          name: "api",
          projectName: "Console",
          environmentName: "production",
          sourceType: "compose"
        },
        target: {
          serverName: "foundation",
          targetKind: "docker-engine",
          imageTag: "ghcr.io/example/api:sha-123"
        },
        preflightChecks: [{ status: "ok", detail: "Service is deployable." }],
        steps: ["Render compose delta", "Queue execution handoff"],
        executeCommand: "daoflow deploy",
        isReady: true,
        currentDeployment: null
      },
      isLoading: false,
      error: null
    });

    triggerDeployUseMutationMock.mockImplementation(
      (options?: { onSuccess?: (deployment: { id: string }) => void }) => ({
        mutate: triggerDeployMutateMock,
        error: null,
        options
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("previews and queues a registered service rollout", async () => {
    renderPanel("/deploy?source=service&serviceId=svc_api");

    expect(screen.getByTestId("service-rollout-summary")).toHaveTextContent("Console / production");
    expect(screen.getByTestId("service-rollout-apply-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("service-rollout-image"), {
      target: { value: "ghcr.io/example/api:sha-123" }
    });
    fireEvent.click(screen.getByTestId("service-rollout-preview-button"));

    expect(await screen.findByTestId("service-rollout-preview")).toBeVisible();
    expect(screen.getByTestId("service-rollout-apply-button")).toBeEnabled();

    fireEvent.click(screen.getByTestId("service-rollout-apply-button"));

    expect(triggerDeployMutateMock).toHaveBeenCalledWith({
      serviceId: "svc_api",
      imageTag: "ghcr.io/example/api:sha-123"
    });

    const triggerDeployMutation = triggerDeployUseMutationMock.mock.results.at(-1)?.value as {
      options?: {
        onSuccess?: (deployment: { id: string }) => void;
      };
    };

    triggerDeployMutation.options?.onSuccess?.({ id: "dep_service_1" });

    expect(await screen.findByTestId("service-rollout-success")).toHaveTextContent("dep_service_1");

    fireEvent.click(screen.getByTestId("service-rollout-open-service"));
    expect(navigateMock).toHaveBeenCalledWith("/services/svc_api");
  });
});
