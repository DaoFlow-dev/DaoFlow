// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";

const {
  infrastructureInventoryUseQueryMock,
  recentDeploymentsUseQueryMock,
  serverReadinessUseQueryMock,
  navigateMock
} = vi.hoisted(() => ({
  infrastructureInventoryUseQueryMock: vi.fn(),
  recentDeploymentsUseQueryMock: vi.fn(),
  serverReadinessUseQueryMock: vi.fn(),
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
    serverReadinessUseQueryMock.mockReturnValue({
      data: {
        checks: []
      }
    });
    recentDeploymentsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false
    });
    infrastructureInventoryUseQueryMock.mockReturnValue({
      data: {
        servers: [{ id: "server_1" }],
        projects: [{ id: "project_1", serviceCount: 3 }],
        summary: {
          totalServices: 3
        }
      }
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
      }
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
      isLoading: false
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
});
