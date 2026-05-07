// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerDetailPage from "./ServerDetailPage";

const {
  collectUseMutationMock,
  hubUseQueryMock,
  logsUseQueryMock,
  planUseMutationMock,
  previewUseMutationMock,
  runUseMutationMock,
  useSessionMock,
  useUtilsMock,
  viewerUseQueryMock
} = vi.hoisted(() => ({
  collectUseMutationMock: vi.fn(),
  hubUseQueryMock: vi.fn(),
  logsUseQueryMock: vi.fn(),
  planUseMutationMock: vi.fn(),
  previewUseMutationMock: vi.fn(),
  runUseMutationMock: vi.fn(),
  useSessionMock: vi.fn(),
  useUtilsMock: vi.fn(),
  viewerUseQueryMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  useSession: useSessionMock
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    viewer: { useQuery: viewerUseQueryMock },
    serverOperationsHub: { useQuery: hubUseQueryMock },
    serverOperationLogs: { useQuery: logsUseQueryMock },
    collectServerResources: { useMutation: collectUseMutationMock },
    previewServerCleanup: { useMutation: previewUseMutationMock },
    runServerCleanup: { useMutation: runUseMutationMock },
    planServerPatches: { useMutation: planUseMutationMock }
  }
}));

describe("ServerDetailPage", () => {
  const hubRefetch = vi.fn();
  const collectMutateAsync = vi.fn();
  const previewMutateAsync = vi.fn();

  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: { user: { id: "user_1" } } });
    useUtilsMock.mockReturnValue({ serverReadiness: { invalidate: vi.fn() } });
    viewerUseQueryMock.mockReturnValue({
      data: { authz: { capabilities: ["server:read", "server:write"] } },
      isLoading: false
    });
    hubRefetch.mockResolvedValue({});
    hubUseQueryMock.mockReturnValue({
      isLoading: false,
      refetch: hubRefetch,
      data: {
        server: {
          id: "srv_1",
          name: "edge-1",
          host: "203.0.113.42",
          kind: "docker-engine",
          status: "ready"
        },
        latestResource: {
          cpu: { loadPercent: 12 },
          memory: { usedPercent: 38 },
          disk: { usedPercent: 55 },
          docker: { reachable: true, diskUsage: [] }
        },
        operations: [
          {
            id: "op_preview",
            kind: "cleanup_preview",
            status: "completed",
            dryRun: true,
            summary: "Cleanup preview found 1 exited container.",
            result: {},
            createdAt: "2026-05-06T00:00:00.000Z",
            completedAt: "2026-05-06T00:00:01.000Z"
          }
        ]
      }
    });
    logsUseQueryMock.mockReturnValue({ data: { logs: [] } });
    collectMutateAsync.mockResolvedValue({ status: "ok" });
    previewMutateAsync.mockResolvedValue({ status: "ok" });
    collectUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: collectMutateAsync });
    previewUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: previewMutateAsync });
    runUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    planUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  });

  it("renders server operations and runs resource checks", async () => {
    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("edge-1")).toBeInTheDocument();
    expect(screen.getByTestId("server-resources-srv_1")).toHaveTextContent("12%");
    fireEvent.click(screen.getByRole("button", { name: "Check Now" }));

    await waitFor(() => {
      expect(collectMutateAsync).toHaveBeenCalledWith({ serverId: "srv_1" });
    });
  });
});
