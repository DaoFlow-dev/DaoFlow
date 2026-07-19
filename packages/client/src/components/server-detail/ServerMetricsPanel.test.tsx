// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerMetricsPanel } from "./ServerMetricsPanel";

const { configurePolicyUseMutationMock, metricsUseQueryMock, refetchMock, useSessionMock } =
  vi.hoisted(() => ({
    configurePolicyUseMutationMock: vi.fn(),
    metricsUseQueryMock: vi.fn(),
    refetchMock: vi.fn(),
    useSessionMock: vi.fn()
  }));

vi.mock("@/lib/auth-client", () => ({ useSession: useSessionMock }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    serverMetricMonitoring: { useQuery: metricsUseQueryMock },
    configureServerMetricPolicy: { useMutation: configurePolicyUseMutationMock }
  }
}));

const policy = {
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
};

const sample = {
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
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    serverId: "srv_1",
    policy,
    state: {
      status: "healthy",
      metric: null,
      measuredValue: null,
      threshold: null,
      changedAt: null,
      lastAlertedAt: null,
      error: null
    },
    latest: sample,
    history: [sample],
    ...overrides
  };
}

describe("ServerMetricsPanel", () => {
  const mutateAsync = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    cleanup();
    useSessionMock.mockReturnValue({ data: { user: { id: "user_1" } } });
    refetchMock.mockResolvedValue({});
    onSaved.mockResolvedValue(undefined);
    mutateAsync.mockResolvedValue(policy);
    metricsUseQueryMock.mockReturnValue({
      data: report(),
      isLoading: false,
      isError: false,
      refetch: refetchMock
    });
    configurePolicyUseMutationMock.mockReturnValue({ isPending: false, mutateAsync });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the bounded history query and renders status, latest values, history, and policy", () => {
    render(<ServerMetricsPanel serverId="srv_1" canManage onSaved={onSaved} />);

    expect(metricsUseQueryMock).toHaveBeenCalledWith(
      { serverId: "srv_1", limit: 60, since: "24h" },
      { enabled: true }
    );
    expect(screen.getByTestId("server-metrics-status-srv_1")).toHaveTextContent("Healthy");
    expect(screen.getByTestId("server-metrics-latest-cpu-value-srv_1")).toHaveTextContent("12.5%");
    expect(screen.getByTestId("server-metrics-latest-memory-value-srv_1")).toHaveTextContent("38%");
    expect(screen.getByTestId("server-metrics-latest-disk-value-srv_1")).toHaveTextContent("55%");
    expect(screen.getByTestId("server-metrics-latest-docker-disk-value-srv_1")).toHaveTextContent(
      "42%"
    );
    expect(screen.getByTestId("server-metrics-history-row-metric_1")).toBeVisible();
    expect(screen.getByTestId("server-metrics-zero-help-srv_1")).toHaveTextContent(
      "A threshold set to 0 disables that threshold"
    );
    expect(screen.getByTestId("server-metrics-sample-age-srv_1")).toHaveTextContent("Sample age:");
  });

  it("saves all policy fields for an owner or admin with server write access", async () => {
    render(<ServerMetricsPanel serverId="srv_1" canManage onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId("server-metrics-policy-cpuWarnPercent-srv_1"), {
      target: { value: "72" }
    });
    fireEvent.change(screen.getByTestId("server-metrics-policy-dockerDiskHardPercent-srv_1"), {
      target: { value: "0" }
    });
    fireEvent.click(screen.getByTestId("server-metrics-save-srv_1"));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        serverId: "srv_1",
        sampleIntervalSeconds: 60,
        retentionDays: 7,
        cpuWarnPercent: 72,
        cpuHardPercent: 90,
        memoryWarnPercent: 75,
        memoryHardPercent: 90,
        diskWarnPercent: 80,
        diskHardPercent: 95,
        dockerDiskWarnPercent: 80,
        dockerDiskHardPercent: 0,
        cooldownMinutes: 15
      });
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByTestId("server-metrics-feedback-srv_1")).toHaveTextContent(
      "Metrics policy saved."
    );
  });

  it("keeps policy read-only and distinguishes an unreachable server", () => {
    metricsUseQueryMock.mockReturnValue({
      data: report({
        state: {
          status: "unreachable",
          metric: null,
          measuredValue: null,
          threshold: null,
          changedAt: null,
          lastAlertedAt: null,
          error: "Connection timed out."
        }
      }),
      isLoading: false,
      isError: false,
      refetch: refetchMock
    });

    render(<ServerMetricsPanel serverId="srv_1" canManage={false} />);

    expect(screen.getByTestId("server-metrics-status-srv_1")).toHaveTextContent("Unreachable");
    expect(screen.getByTestId("server-metrics-unreachable-srv_1")).toHaveTextContent(
      "does not automatically remediate"
    );
    expect(screen.getByTestId("server-metrics-policy-cpuWarnPercent-srv_1")).toHaveAttribute(
      "readonly"
    );
    expect(screen.getByTestId("server-metrics-read-only-srv_1")).toBeVisible();
    expect(screen.queryByTestId("server-metrics-save-srv_1")).not.toBeInTheDocument();
  });

  it("shows every active threshold instead of only the newest alert", () => {
    metricsUseQueryMock.mockReturnValue({
      data: report({
        state: {
          status: "hard",
          metric: "cpu",
          measuredValue: 94,
          threshold: 90,
          activeMetrics: [
            { metric: "cpu", status: "hard", measuredValue: 94, threshold: 90 },
            { metric: "disk", status: "warning", measuredValue: 84, threshold: 80 }
          ],
          changedAt: new Date().toISOString(),
          lastAlertedAt: new Date().toISOString(),
          error: null
        }
      }),
      isLoading: false,
      isError: false,
      refetch: refetchMock
    });

    render(<ServerMetricsPanel serverId="srv_1" canManage />);

    expect(screen.getByTestId("server-metrics-state-details-srv_1")).toHaveTextContent(
      "cpu: 94% (hard threshold 90%)"
    );
    expect(screen.getByTestId("server-metrics-state-details-srv_1")).toHaveTextContent(
      "disk: 84% (warning threshold 80%)"
    );
  });
});
