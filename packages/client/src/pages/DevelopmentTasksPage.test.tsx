// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevelopmentTasksPage from "./DevelopmentTasksPage";

const { developmentTasksUseQueryMock, sandboxRunnerProfilesUseQueryMock } = vi.hoisted(() => ({
  developmentTasksUseQueryMock: vi.fn(),
  sandboxRunnerProfilesUseQueryMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    developmentTasks: {
      useQuery: developmentTasksUseQueryMock
    },
    sandboxRunnerProfiles: {
      useQuery: sandboxRunnerProfilesUseQueryMock
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
    sandboxRunnerProfilesUseQueryMock.mockReturnValue({
      data: [
        {
          id: "runner_profile_host_default",
          name: "Host Docker Default",
          provider: "host_docker",
          status: "enabled",
          image: "ghcr.io/daoflow/codex-runner:latest",
          cpuLimit: 2,
          memoryLimitMb: 4096,
          diskLimitMb: 20480,
          codexAuthMode: "custom_provider_env",
          validationCommands: ["bun run test:unit", "bun run typecheck"]
        }
      ],
      isError: false,
      isLoading: false
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
    expect(screen.getByText("Host Docker Default")).toBeInTheDocument();
    expect(screen.getByText(/host docker/)).toBeInTheDocument();
    expect(screen.getByText(/bun run typecheck/)).toBeInTheDocument();
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

  it("filters tasks by status", () => {
    render(
      <MemoryRouter>
        <DevelopmentTasksPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Task status filter" }));
    fireEvent.click(screen.getByRole("option", { name: "failed" }));

    expect(developmentTasksUseQueryMock).toHaveBeenLastCalledWith({
      limit: 50,
      status: "failed"
    });
  });

  it("shows a runner profile load error", () => {
    sandboxRunnerProfilesUseQueryMock.mockReturnValueOnce({
      data: undefined,
      isError: true,
      isLoading: false
    });

    render(
      <MemoryRouter>
        <DevelopmentTasksPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Unable to load sandbox runner profiles.")).toBeInTheDocument();
  });
});
