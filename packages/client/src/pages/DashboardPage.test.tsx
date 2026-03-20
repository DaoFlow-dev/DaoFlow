// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./DashboardPage";

const {
  infrastructureInventoryUseQueryMock,
  recentDeploymentsUseQueryMock,
  serverReadinessUseQueryMock
} = vi.hoisted(() => ({
  infrastructureInventoryUseQueryMock: vi.fn(),
  recentDeploymentsUseQueryMock: vi.fn(),
  serverReadinessUseQueryMock: vi.fn()
}));

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
  });
});
