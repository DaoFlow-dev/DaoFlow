// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeploymentsPage from "./DeploymentsPage";

const { cancelDeploymentUseMutationMock, recentDeploymentsUseQueryMock, navigateMock } = vi.hoisted(
  () => ({
    cancelDeploymentUseMutationMock: vi.fn(),
    recentDeploymentsUseQueryMock: vi.fn(),
    navigateMock: vi.fn()
  })
);

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");

  return {
    ...actual,
    useNavigate: () => navigateMock
  };
});

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1"
      }
    }
  })
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    recentDeployments: {
      useQuery: recentDeploymentsUseQueryMock
    },
    cancelDeployment: {
      useMutation: cancelDeploymentUseMutationMock
    }
  }
}));

vi.mock("@/components/DeploymentRollbackDialog", () => ({
  default: () => null
}));

vi.mock("@/components/DeploymentLogViewer", () => ({
  default: () => <div data-testid="deployment-log-viewer">logs</div>
}));

describe("DeploymentsPage", () => {
  function renderDeploymentsPage() {
    return render(
      <MemoryRouter initialEntries={["/deployments"]}>
        <DeploymentsPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dep_1",
          serviceId: "svc_api",
          serviceName: "api",
          environmentName: "production",
          targetServerName: "foundation-1",
          statusTone: "success",
          statusLabel: "Healthy",
          lifecycleStatus: "healthy",
          status: "healthy",
          sourceType: "compose",
          createdAt: "2026-03-20T00:00:00.000Z",
          canRollback: true,
          conclusion: "success",
          steps: []
        },
        {
          id: "dep_2",
          serviceId: "svc_web",
          serviceName: "web",
          environmentName: "staging",
          targetServerName: "foundation-2",
          statusTone: "warning",
          statusLabel: "Running",
          lifecycleStatus: "running",
          status: "running",
          sourceType: "compose",
          createdAt: "2026-03-20T01:00:00.000Z",
          canRollback: false,
          conclusion: null,
          recoveryGuidance: {
            source: "watchdog",
            summary: "DaoFlow stopped waiting because deployment progress went silent.",
            suspectedRootCause: "Deployment progress heartbeat timed out.",
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
          },
          steps: []
        }
      ],
      isLoading: false,
      refetch: vi.fn()
    });
    cancelDeploymentUseMutationMock.mockReturnValue({
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows filtered-empty state and clears search filters back to the deployment table", () => {
    renderDeploymentsPage();

    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by service name..."), {
      target: { value: "missing-service" }
    });

    expect(screen.getByText("No deployments match your filters.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("routes the no-deployments empty state into the deploy center", () => {
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn()
    });

    renderDeploymentsPage();

    fireEvent.click(screen.getByTestId("deployments-empty-open-deploy"));

    expect(navigateMock).toHaveBeenCalledWith("/deploy");
  });

  it("shows recovery guidance for stalled deployments in expanded history rows", () => {
    renderDeploymentsPage();

    fireEvent.click(screen.getByText("web"));

    expect(screen.getByTestId("deployment-recovery-guidance-dep_2")).toHaveTextContent(
      "DaoFlow stopped waiting because deployment progress went silent."
    );
    expect(screen.getByTestId("deployment-recovery-root-cause-dep_2")).toHaveTextContent(
      "Deployment progress heartbeat timed out."
    );
    expect(
      screen.getByText("Inspect the deployment logs immediately before the stall.")
    ).toBeVisible();
    expect(
      screen.getByTestId("deployment-recovery-evidence-dep_2-deployment-watchdog-timeout")
    ).toHaveTextContent("watchdog:Progress heartbeat timed out");
  });
});
