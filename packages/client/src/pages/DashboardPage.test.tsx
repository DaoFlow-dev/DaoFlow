// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";

const {
  infrastructureInventoryUseQueryMock,
  recentDeploymentsUseQueryMock,
  serverReadinessUseQueryMock,
  retryInfrastructureMock,
  retryRecentDeploymentsMock,
  retryServerReadinessMock,
  navigateMock
} = vi.hoisted(() => ({
  infrastructureInventoryUseQueryMock: vi.fn(),
  recentDeploymentsUseQueryMock: vi.fn(),
  serverReadinessUseQueryMock: vi.fn(),
  retryInfrastructureMock: vi.fn(),
  retryRecentDeploymentsMock: vi.fn(),
  retryServerReadinessMock: vi.fn(),
  navigateMock: vi.fn()
}));

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
    serverReadiness: {
      useQuery: serverReadinessUseQueryMock
    },
    recentDeployments: {
      useQuery: recentDeploymentsUseQueryMock
    },
    infrastructureInventory: {
      useQuery: infrastructureInventoryUseQueryMock
    }
  }
}));

describe("DashboardPage", () => {
  function renderDashboardPage() {
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    navigateMock.mockReset();
    retryInfrastructureMock.mockReset();
    retryRecentDeploymentsMock.mockReset();
    retryServerReadinessMock.mockReset();
    serverReadinessUseQueryMock.mockReturnValue({
      data: { checks: [] },
      error: null,
      isError: false,
      isFetching: false,
      refetch: retryServerReadinessMock
    });
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: retryRecentDeploymentsMock
    });
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [{ id: "server_1" }],
        projects: [{ id: "project_1", serviceCount: 3 }],
        summary: {
          totalServices: 3
        }
      },
      error: null,
      isError: false,
      isFetching: false,
      refetch: retryInfrastructureMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses responsive stats grid spacing and column layout", () => {
    renderDashboardPage();

    const statsGrid = screen.getByTestId("dashboard-stats-grid");

    expect(statsGrid).toHaveClass("grid-cols-2", "gap-3", "md:grid-cols-4", "md:gap-4", "xl:gap-5");
    expect(screen.getByTestId("dashboard-stat-servers")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-stat-projects")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-stat-deployments")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-stat-services")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-operational-attention")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-query-errors")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dashboard-stat-servers"));
    expect(navigateMock).toHaveBeenCalledWith("/servers");
  });

  it("surfaces operational attention with direct recovery actions", () => {
    serverReadinessUseQueryMock.mockReturnValue({
      data: {
        checks: [
          {
            serverId: "server_1",
            serverName: "foundation",
            serverHost: "10.0.0.12",
            readinessStatus: "blocked",
            dockerReachable: false
          }
        ]
      },
      error: null,
      isError: false,
      isFetching: false,
      refetch: retryServerReadinessMock
    });
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dep_1",
          serviceName: "api",
          status: "failed",
          statusLabel: "Failed",
          statusTone: "failed"
        }
      ],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: retryRecentDeploymentsMock
    });

    renderDashboardPage();

    expect(screen.getByTestId("dashboard-operational-attention")).toBeVisible();
    expect(screen.getByTestId("dashboard-attention-server-server_1")).toHaveTextContent(
      "foundation"
    );
    expect(screen.getByTestId("dashboard-attention-deployment-dep_1")).toHaveTextContent("api");

    fireEvent.click(screen.getByTestId("dashboard-review-deployments"));
    expect(navigateMock).toHaveBeenCalledWith("/deployments");

    fireEvent.click(screen.getByTestId("dashboard-review-servers"));
    expect(navigateMock).toHaveBeenCalledWith("/servers");
  });

  it("surfaces query failures with retry actions instead of empty states", () => {
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("inventory gateway timed out"),
      isError: true,
      isFetching: false,
      refetch: retryInfrastructureMock
    });
    serverReadinessUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("readiness check failed"),
      isError: true,
      isFetching: false,
      refetch: retryServerReadinessMock
    });
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("deployment feed failed"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: retryRecentDeploymentsMock
    });

    renderDashboardPage();

    expect(screen.getByTestId("dashboard-query-error-infrastructure")).toHaveTextContent(
      "inventory gateway timed out"
    );
    expect(screen.getByTestId("dashboard-query-error-server-readiness")).toHaveTextContent(
      "readiness check failed"
    );
    expect(screen.getByTestId("dashboard-recent-activity-error")).toHaveTextContent(
      "deployment feed failed"
    );

    fireEvent.click(screen.getByTestId("dashboard-query-retry-infrastructure"));
    fireEvent.click(screen.getByTestId("dashboard-query-retry-server-readiness"));
    fireEvent.click(
      within(screen.getByTestId("dashboard-recent-activity-error")).getByText("Retry")
    );

    expect(retryInfrastructureMock).toHaveBeenCalledTimes(1);
    expect(retryServerReadinessMock).toHaveBeenCalledTimes(1);
    expect(retryRecentDeploymentsMock).toHaveBeenCalledTimes(1);
  });
});
