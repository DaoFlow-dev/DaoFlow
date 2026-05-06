// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevelopmentTaskDetailPage from "./DevelopmentTaskDetailPage";

const {
  cancelDevelopmentTaskUseMutationMock,
  developmentTaskDetailsUseQueryMock,
  retryDevelopmentTaskUseMutationMock
} = vi.hoisted(() => ({
  cancelDevelopmentTaskUseMutationMock: vi.fn(),
  developmentTaskDetailsUseQueryMock: vi.fn(),
  retryDevelopmentTaskUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    cancelDevelopmentTask: {
      useMutation: cancelDevelopmentTaskUseMutationMock
    },
    developmentTaskDetails: {
      useQuery: developmentTaskDetailsUseQueryMock
    },
    retryDevelopmentTask: {
      useMutation: retryDevelopmentTaskUseMutationMock
    }
  }
}));

describe("DevelopmentTaskDetailPage", () => {
  const cancelMutateAsync = vi.fn();
  const refetchMock = vi.fn();
  const retryMutateAsync = vi.fn();

  beforeEach(() => {
    cancelMutateAsync.mockResolvedValue({ status: "canceled" });
    refetchMock.mockResolvedValue({});
    retryMutateAsync.mockResolvedValue({ status: "queued" });
    cancelDevelopmentTaskUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: cancelMutateAsync
    });
    retryDevelopmentTaskUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: retryMutateAsync
    });
    developmentTaskDetailsUseQueryMock.mockReturnValue({
      isLoading: false,
      refetch: refetchMock,
      data: {
        task: {
          id: "dtask_1",
          repoFullName: "DaoFlow-dev/DaoFlow",
          issueNumber: 185,
          issueTitle: "Major: Agent swarm dev platform",
          issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
          issueAuthor: "MikeChongCan",
          requestedByExternalUser: "octocat",
          status: "running"
        },
        runs: [
          {
            id: "drun_1",
            status: "claimed",
            runnerId: "development-task-worker",
            branchName: null,
            pullRequestUrl: null,
            previewUrl: null,
            failureCategory: null,
            failureMessage: null,
            metadata: {
              codexExecution: {
                logPath: "/runner/work/drun_1/logs/codex-exec.jsonl"
              },
              validation: {
                logPath: "/runner/work/drun_1/logs/validation.jsonl"
              },
              pullRequest: {
                logPath: "/runner/work/drun_1/logs/pull-request.jsonl",
                reviewArtifacts: {
                  diffStatPath: "/runner/work/drun_1/artifacts/diff-stat.txt",
                  changedFilesPath: "/runner/work/drun_1/artifacts/changed-files.json"
                }
              }
            }
          }
        ],
        events: [
          {
            id: "devent_1",
            kind: "run.claimed",
            summary: "development-task-worker claimed the development task.",
            detail: null,
            createdAt: "2026-05-06T03:40:00.000Z"
          }
        ],
        comments: [
          {
            id: "dcomment_1",
            commentKind: "trigger",
            externalCommentId: "440001",
            updatedAt: "2026-05-06T03:39:00.000Z"
          }
        ]
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders task details, latest run, timeline, and tracked comments", () => {
    render(
      <MemoryRouter initialEntries={["/development-tasks/dtask_1"]}>
        <Routes>
          <Route path="/development-tasks/:id" element={<DevelopmentTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Major: Agent swarm dev platform/)).toBeInTheDocument();
    expect(screen.getByText("DaoFlow-dev/DaoFlow")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("claimed")).toBeInTheDocument();
    expect(screen.getByText("/runner/work/drun_1/artifacts/diff-stat.txt")).toBeInTheDocument();
    expect(
      screen.getByText("/runner/work/drun_1/artifacts/changed-files.json")
    ).toBeInTheDocument();
    expect(screen.getByText(/Codex log: .*codex-exec\.jsonl/)).toBeInTheDocument();
    expect(screen.getByText(/Validation log: .*validation\.jsonl/)).toBeInTheDocument();
    expect(screen.getByText(/Review handoff log: .*pull-request\.jsonl/)).toBeInTheDocument();
    expect(screen.getByText("run.claimed")).toBeInTheDocument();
    expect(screen.getByText("440001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute(
      "href",
      "/development-tasks"
    );
  });

  it("cancels a running development task", async () => {
    render(
      <MemoryRouter initialEntries={["/development-tasks/dtask_1"]}>
        <Routes>
          <Route path="/development-tasks/:id" element={<DevelopmentTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(cancelMutateAsync).toHaveBeenCalledWith({ taskId: "dtask_1" });
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Development task canceled.")).toBeInTheDocument();
  });

  it("retries a failed development task", async () => {
    developmentTaskDetailsUseQueryMock.mockReturnValueOnce({
      isLoading: false,
      refetch: refetchMock,
      data: {
        task: {
          id: "dtask_1",
          repoFullName: "DaoFlow-dev/DaoFlow",
          issueNumber: 185,
          issueTitle: "Major: Agent swarm dev platform",
          issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
          issueAuthor: "MikeChongCan",
          requestedByExternalUser: "octocat",
          status: "failed"
        },
        runs: [],
        events: [],
        comments: []
      }
    });

    render(
      <MemoryRouter initialEntries={["/development-tasks/dtask_1"]}>
        <Routes>
          <Route path="/development-tasks/:id" element={<DevelopmentTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(retryMutateAsync).toHaveBeenCalledWith({ taskId: "dtask_1" });
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Development task retry queued.")).toBeInTheDocument();
  });

  it("shows run failure diagnostics and event details", () => {
    developmentTaskDetailsUseQueryMock.mockReturnValueOnce({
      isLoading: false,
      refetch: refetchMock,
      data: {
        task: {
          id: "dtask_1",
          repoFullName: "DaoFlow-dev/DaoFlow",
          issueNumber: 185,
          issueTitle: "Major: Agent swarm dev platform",
          issueUrl: "https://github.com/DaoFlow-dev/DaoFlow/issues/185",
          issueAuthor: "MikeChongCan",
          requestedByExternalUser: "octocat",
          status: "failed"
        },
        runs: [
          {
            id: "drun_1",
            status: "failed",
            runnerId: "development-task-worker",
            branchName: "daoflow/issue-185",
            pullRequestUrl: null,
            previewUrl: null,
            failureCategory: "validation_failed",
            failureMessage: "bun run typecheck failed."
          }
        ],
        events: [
          {
            id: "devent_1",
            kind: "run.failed",
            summary: "Development task run moved to failed.",
            detail: "bun run typecheck failed.",
            createdAt: "2026-05-06T03:40:00.000Z"
          }
        ],
        comments: []
      }
    });

    render(
      <MemoryRouter initialEntries={["/development-tasks/dtask_1"]}>
        <Routes>
          <Route path="/development-tasks/:id" element={<DevelopmentTaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Failure: validation_failed")).toBeInTheDocument();
    expect(screen.getAllByText("bun run typecheck failed.")).toHaveLength(2);
  });
});
