// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevelopmentTasksPage from "./DevelopmentTasksPage";

const { developmentTasksUseQueryMock } = vi.hoisted(() => ({
  developmentTasksUseQueryMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    developmentTasks: {
      useQuery: developmentTasksUseQueryMock
    }
  }
}));

describe("DevelopmentTasksPage", () => {
  const refetchMock = vi.fn();

  beforeEach(() => {
    refetchMock.mockReset();
    developmentTasksUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dtask_1",
          repoFullName: "DaoFlow-dev/DaoFlow",
          issueNumber: 185,
          issueTitle: "Major: Agent swarm dev platform",
          issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
          issueAuthor: "MikeChongCan",
          requestedByExternalUser: "octocat",
          status: "queued",
          createdAt: "2026-05-06T03:33:42.000Z"
        }
      ],
      isLoading: false,
      refetch: refetchMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders queued issue-triggered development tasks", () => {
    render(
      <MemoryRouter>
        <DevelopmentTasksPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Major: Agent swarm dev platform/)).toBeInTheDocument();
    expect(screen.getByText("DaoFlow-dev/DaoFlow")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/development-tasks/dtask_1"
    );
  });

  it("refreshes the development task queue", () => {
    render(
      <MemoryRouter>
        <DevelopmentTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
