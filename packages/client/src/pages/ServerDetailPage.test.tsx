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
  serverIdentitiesUseQueryMock,
  approveIdentityUseMutationMock,
  rotateIdentityUseMutationMock,
  scanIdentityUseMutationMock,
  nodeSwarmUseMutationMock,
  configureServerCapacityUseMutationMock,
  configureServerMetricPolicyUseMutationMock,
  serverMetricMonitoringUseQueryMock,
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
  serverIdentitiesUseQueryMock: vi.fn(),
  approveIdentityUseMutationMock: vi.fn(),
  rotateIdentityUseMutationMock: vi.fn(),
  scanIdentityUseMutationMock: vi.fn(),
  nodeSwarmUseMutationMock: vi.fn(),
  configureServerCapacityUseMutationMock: vi.fn(),
  configureServerMetricPolicyUseMutationMock: vi.fn(),
  serverMetricMonitoringUseQueryMock: vi.fn(),
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
    updateSwarmServiceScale: { useMutation: scaleSwarmUseMutationMock },
    configureServerCapacity: { useMutation: configureServerCapacityUseMutationMock },
    configureServerMetricPolicy: { useMutation: configureServerMetricPolicyUseMutationMock },
    serverMetricMonitoring: { useQuery: serverMetricMonitoringUseQueryMock },
    serverSshHostIdentities: { useQuery: serverIdentitiesUseQueryMock },
    scanServerSshHostIdentities: { useMutation: scanIdentityUseMutationMock },
    approveServerSshHostIdentity: { useMutation: approveIdentityUseMutationMock },
    rotateServerSshHostIdentity: { useMutation: rotateIdentityUseMutationMock }
  }
}));

describe("ServerDetailPage", () => {
  const hubRefetch = vi.fn();
  const collectMutateAsync = vi.fn();
  const previewMutateAsync = vi.fn();
  const configureServerCapacityMutateAsync = vi.fn();
  const configureServerMetricPolicyMutateAsync = vi.fn();

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: { user: { id: "user_1" } } });
    useUtilsMock.mockReturnValue({ serverReadiness: { invalidate: vi.fn() } });
    viewerUseQueryMock.mockReturnValue({
      data: { authz: { role: "admin", capabilities: ["server:read", "server:write"] } },
      isLoading: false
    });
    hubRefetch.mockResolvedValue({});
    configureServerCapacityMutateAsync.mockClear();
    configureServerMetricPolicyMutateAsync.mockClear();
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
          swarmTopology: null,
          maxConcurrentBuilds: 4,
          maxQueuedDeployments: 75
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
    serverMetricMonitoringUseQueryMock.mockReturnValue({
      data: {
        serverId: "srv_1",
        policy: {
          sampleIntervalSeconds: 60,
          retentionDays: 7,
          cpuWarnPercent: 70,
          cpuHardPercent: 90,
          memoryWarnPercent: 75,
          memoryHardPercent: 90,
          diskWarnPercent: 80,
          diskHardPercent: 95,
          dockerDiskWarnPercent: 80,
          dockerDiskHardPercent: 95,
          cooldownMinutes: 15
        },
        state: {
          status: "healthy",
          metric: null,
          measuredValue: null,
          threshold: null,
          changedAt: null,
          lastAlertedAt: null,
          error: null
        },
        latest: {
          id: "metric_1",
          serverId: "srv_1",
          cpuPercent: 12.5,
          memoryUsedPercent: 38,
          memoryUsedGB: 6.08,
          memoryTotalGB: 16,
          diskUsedPercent: 55,
          diskTotalGB: 100,
          dockerDiskUsedPercent: 42,
          dockerDiskTotalGB: 80,
          networkInMB: 100,
          networkOutMB: 25,
          collectedAt: new Date().toISOString()
        },
        history: []
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    serverIdentitiesUseQueryMock.mockReturnValue({
      data: {
        approved: null,
        identities: [
          {
            id: "identity_1",
            algorithm: "ssh-ed25519",
            publicKey: "AQIDBA==",
            fingerprint: "SHA256:fixture",
            status: "observed",
            observedAt: "2026-07-18T00:00:00.000Z",
            lastObservedAt: "2026-07-18T00:00:00.000Z",
            approvedAt: null,
            supersededAt: null
          }
        ]
      },
      isLoading: false,
      refetch: vi.fn()
    });
    collectMutateAsync.mockResolvedValue({ status: "ok" });
    previewMutateAsync.mockResolvedValue({ status: "ok" });
    collectUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: collectMutateAsync });
    previewUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: previewMutateAsync });
    runUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    planUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    refreshSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    nodeSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    scaleSwarmUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    configureServerCapacityMutateAsync.mockResolvedValue({
      id: "srv_1",
      maxConcurrentBuilds: 6,
      maxQueuedDeployments: 120
    });
    configureServerCapacityUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: configureServerCapacityMutateAsync
    });
    configureServerMetricPolicyMutateAsync.mockResolvedValue({
      sampleIntervalSeconds: 60,
      retentionDays: 7,
      cpuWarnPercent: 70,
      cpuHardPercent: 90,
      memoryWarnPercent: 75,
      memoryHardPercent: 90,
      diskWarnPercent: 80,
      diskHardPercent: 95,
      dockerDiskWarnPercent: 80,
      dockerDiskHardPercent: 95,
      cooldownMinutes: 15
    });
    configureServerMetricPolicyUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: configureServerMetricPolicyMutateAsync
    });
    scanIdentityUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    approveIdentityUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    rotateIdentityUseMutationMock.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
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

  it("renders the current server capacity values", () => {
    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-capacity-tab-srv_1"));

    expect(screen.getByTestId("server-capacity-panel-srv_1")).toBeVisible();
    expect(screen.getByTestId("server-capacity-builds-srv_1")).toHaveValue(4);
    expect(screen.getByTestId("server-capacity-queued-srv_1")).toHaveValue(75);
    expect(screen.getByTestId("server-capacity-build-slot-explanation-srv_1")).toHaveTextContent(
      "Image-only and runtime-only deployments do not use build slots"
    );
  });

  it("opens the persistent metrics panel from the Metrics tab", () => {
    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-metrics-tab-srv_1"));

    expect(screen.getByTestId("server-metrics-panel-srv_1")).toBeVisible();
    expect(screen.getByTestId("server-metrics-status-srv_1")).toHaveTextContent("Healthy");
  });

  it("keeps metrics policy read-only for operators even with server write access", () => {
    viewerUseQueryMock.mockReturnValue({
      data: { authz: { role: "operator", capabilities: ["server:read", "server:write"] } },
      isLoading: false
    });

    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-metrics-tab-srv_1"));

    expect(screen.getByTestId("server-metrics-read-only-srv_1")).toBeVisible();
    expect(screen.queryByTestId("server-metrics-save-srv_1")).not.toBeInTheDocument();
  });

  it("saves changed server capacity with the expected payload", async () => {
    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-capacity-tab-srv_1"));
    fireEvent.change(screen.getByTestId("server-capacity-builds-srv_1"), {
      target: { value: "6" }
    });
    fireEvent.change(screen.getByTestId("server-capacity-queued-srv_1"), {
      target: { value: "120" }
    });
    fireEvent.click(screen.getByTestId("server-capacity-save-srv_1"));

    await waitFor(() => {
      expect(configureServerCapacityMutateAsync).toHaveBeenCalledWith({
        serverId: "srv_1",
        maxConcurrentBuilds: 6,
        maxQueuedDeployments: 120
      });
    });
    expect(screen.getByTestId("server-capacity-feedback-srv_1")).toHaveTextContent(
      "Server capacity saved."
    );
  });

  it("shows capacity as read-only without server write permission", () => {
    viewerUseQueryMock.mockReturnValue({
      data: { authz: { role: "viewer", capabilities: ["server:read"] } },
      isLoading: false
    });

    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-capacity-tab-srv_1"));

    expect(screen.getByTestId("server-capacity-builds-srv_1")).toHaveAttribute("readonly");
    expect(screen.getByTestId("server-capacity-queued-srv_1")).toHaveAttribute("readonly");
    expect(screen.getByTestId("server-capacity-read-only-srv_1")).toBeVisible();
    expect(screen.queryByTestId("server-capacity-save-srv_1")).not.toBeInTheDocument();
    expect(configureServerCapacityMutateAsync).not.toHaveBeenCalled();
  });

  it("shows owner-only capacity controls as read-only to operators", () => {
    viewerUseQueryMock.mockReturnValue({
      data: {
        authz: { role: "operator", capabilities: ["server:read", "server:write"] }
      },
      isLoading: false
    });

    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-capacity-tab-srv_1"));

    expect(screen.getByTestId("server-capacity-read-only-srv_1")).toBeVisible();
    expect(screen.queryByTestId("server-capacity-save-srv_1")).not.toBeInTheDocument();
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

  it("shows observed host keys in the identity tab before approval", () => {
    render(
      <MemoryRouter initialEntries={["/servers/srv_1"]}>
        <Routes>
          <Route path="/servers/:id" element={<ServerDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId("server-detail-identity-tab-srv_1"));
    expect(screen.getByTestId("ssh-host-identity-panel-srv_1")).toBeVisible();
    expect(screen.getByTestId("ssh-host-identity-unapproved-srv_1")).toHaveTextContent(
      "Remote SSH and SCP operations are blocked."
    );
    expect(screen.getByTestId("ssh-host-identity-approve-identity_1")).toHaveTextContent(
      "Approve exact key"
    );
  });
});
