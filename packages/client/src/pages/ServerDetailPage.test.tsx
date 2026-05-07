// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServerDetailPage from "./ServerDetailPage";

const {
  collectUseMutationMock,
  hubUseQueryMock,
  logsUseQueryMock,
  planUseMutationMock,
  previewUseMutationMock,
  refreshSwarmUseMutationMock,
  runUseMutationMock,
  scaleSwarmUseMutationMock,
  nodeSwarmUseMutationMock,
  useSessionMock,
  useUtilsMock,
  viewerUseQueryMock
} = vi.hoisted(() => ({
  collectUseMutationMock: vi.fn(),
  hubUseQueryMock: vi.fn(),
  logsUseQueryMock: vi.fn(),
  planUseMutationMock: vi.fn(),
  previewUseMutationMock: vi.fn(),
  refreshSwarmUseMutationMock: vi.fn(),
  runUseMutationMock: vi.fn(),
  scaleSwarmUseMutationMock: vi.fn(),
  nodeSwarmUseMutationMock: vi.fn(),
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
    planServerPatches: { useMutation: planUseMutationMock },
    refreshSwarmTopology: { useMutation: refreshSwarmUseMutationMock },
    updateSwarmNodeAvailability: { useMutation: nodeSwarmUseMutationMock },
    updateSwarmServiceScale: { useMutation: scaleSwarmUseMutationMock }
  }
}));

describe("ServerDetailPage", () => {
  const hubRefetch = vi.fn();
  const collectMutateAsync = vi.fn();
  const previewMutateAsync = vi.fn();

  afterEach(() => {
    cleanup();
  });

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
          status: "ready",
          swarmTopology: null
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
    refreshSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    nodeSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    scaleSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
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

  it("shows Swarm operations for Swarm managers", async () => {
    hubUseQueryMock.mockReturnValue({
      isLoading: false,
      refetch: hubRefetch,
      data: {
        server: {
          id: "srv_swarm",
          name: "swarm-1",
          host: "10.0.0.10",
          kind: "docker-swarm-manager",
          status: "ready",
          swarmTopology: {
            clusterId: "swarm-srv",
            clusterName: "production-swarm",
            source: "discovered",
            defaultNamespace: null,
            summary: {
              nodeCount: 1,
              managerCount: 1,
              workerCount: 0,
              activeNodeCount: 1,
              reachableNodeCount: 1
            },
            nodes: [
              {
                id: "manager-a",
                name: "manager-a",
                host: null,
                role: "manager",
                availability: "active",
                reachability: "reachable",
                managerStatus: "leader"
              }
            ]
          }
        },
        latestResource: null,
        operations: []
      }
    });

    render(
      <MemoryRouter initialEntries={["/servers/srv_swarm"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Swarm" }));
    fireEvent.click(screen.getByRole("tab", { name: "Swarm" }));
    await waitFor(() => {
      expect(screen.getByText("production-swarm · discovered · 1 nodes")).toBeVisible();
    });
    expect(screen.getByText("manager · leader · active · reachable")).toBeVisible();
  });
});
