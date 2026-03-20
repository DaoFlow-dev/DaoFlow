// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeploymentLogViewer from "./DeploymentLogViewer";

const useQueryMock = vi.fn(
  (
    input: { query?: string; stream?: "all" | "stdout" | "stderr"; deploymentId: string },
    _options?: { refetchInterval: number }
  ) => {
    const allLines = [
      {
        id: "log_1",
        level: "info",
        message: "Boot complete",
        stream: "stdout",
        createdAt: "2026-03-20T12:00:00.000Z"
      },
      {
        id: "log_2",
        level: "error",
        message: "Readiness probe failed",
        stream: "stderr",
        createdAt: "2026-03-20T12:00:01.000Z"
      }
    ];
    const query = input.query?.toLowerCase() ?? "";
    const lines = allLines.filter((line) => {
      const matchesStream =
        input.stream === "all" || !input.stream ? true : line.stream === input.stream;
      const matchesQuery = query.length === 0 ? true : line.message.toLowerCase().includes(query);
      return matchesStream && matchesQuery;
    });

    return {
      isLoading: false,
      isFetching: false,
      data: {
        summary: {
          totalLines: lines.length,
          stderrLines: lines.filter((line) => line.stream === "stderr").length,
          deploymentCount: 1
        },
        lines
      }
    };
  }
);

Object.assign(globalThis, {
  __deploymentLogViewerUseQueryMock: useQueryMock
});

vi.mock("../lib/trpc", () => ({
  trpc: {
    deploymentLogs: {
      useQuery: (...args: unknown[]) =>
        (
          globalThis as typeof globalThis & {
            __deploymentLogViewerUseQueryMock: typeof useQueryMock;
          }
        ).__deploymentLogViewerUseQueryMock(
          args[0] as Parameters<typeof useQueryMock>[0],
          args[1] as Parameters<typeof useQueryMock>[1]
        )
    }
  }
}));

describe("DeploymentLogViewer", () => {
  it("passes targeted search and stream filters into the deployment logs query", async () => {
    render(<DeploymentLogViewer deploymentId="dep_test_1" />);

    expect(useQueryMock).toHaveBeenCalledWith(
      {
        deploymentId: "dep_test_1",
        query: undefined,
        stream: "all",
        limit: 100
      },
      { refetchInterval: 5000 }
    );

    fireEvent.change(screen.getByTestId("deployment-logs-search-dep_test_1"), {
      target: { value: "readiness" }
    });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenLastCalledWith(
        {
          deploymentId: "dep_test_1",
          query: "readiness",
          stream: "all",
          limit: 100
        },
        { refetchInterval: 5000 }
      );
    });

    fireEvent.click(screen.getByTestId("deployment-logs-stream-dep_test_1-stderr"));

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenLastCalledWith(
        {
          deploymentId: "dep_test_1",
          query: "readiness",
          stream: "stderr",
          limit: 100
        },
        { refetchInterval: 5000 }
      );
    });

    expect(screen.getByText("Readiness probe failed")).toBeInTheDocument();
    expect(screen.getByTestId("deployment-logs-count-dep_test_1")).toHaveTextContent("1 match");
  });
});
