// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevelopmentTaskDetailPage from "./DevelopmentTaskDetailPage";

const { developmentTaskDetailsUseQueryMock } = vi.hoisted(() => ({
  developmentTaskDetailsUseQueryMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    developmentTaskDetails: {
      useQuery: developmentTaskDetailsUseQueryMock
    }
  }
}));

describe("DevelopmentTaskDetailPage", () => {
  beforeEach(() => {
    developmentTaskDetailsUseQueryMock.mockReturnValue({
      isLoading: false,
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
            previewUrl: null
          }
        ],
        events: [
          {
            id: "devent_1",
            kind: "run.claimed",
            summary: "development-task-worker claimed the development task.",
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
    expect(screen.getByText("run.claimed")).toBeInTheDocument();
    expect(screen.getByText("440001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute(
      "href",
      "/development-tasks"
    );
  });
});
