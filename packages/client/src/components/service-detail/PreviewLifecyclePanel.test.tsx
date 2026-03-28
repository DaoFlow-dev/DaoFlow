// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviewLifecyclePanel from "./PreviewLifecyclePanel";

const {
  composePreviewReconciliationUseQueryMock,
  invalidateComposePreviewReconciliationMock,
  invalidateComposePreviewsMock,
  invalidateServiceDetailsMock,
  reconcileComposePreviewsUseMutationMock,
  reconcileMutateAsyncMock,
  triggerDeployUseMutationMock,
  triggerDeployMutateAsyncMock,
  useUtilsMock
} = vi.hoisted(() => ({
  composePreviewReconciliationUseQueryMock: vi.fn(),
  invalidateComposePreviewReconciliationMock: vi.fn(),
  invalidateComposePreviewsMock: vi.fn(),
  invalidateServiceDetailsMock: vi.fn(),
  reconcileComposePreviewsUseMutationMock: vi.fn(),
  reconcileMutateAsyncMock: vi.fn(),
  triggerDeployUseMutationMock: vi.fn(),
  triggerDeployMutateAsyncMock: vi.fn(),
  useUtilsMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    composePreviewReconciliation: {
      useQuery: composePreviewReconciliationUseQueryMock
    },
    reconcileComposePreviews: {
      useMutation: reconcileComposePreviewsUseMutationMock
    },
    triggerDeploy: {
      useMutation: triggerDeployUseMutationMock
    }
  }
}));

const previewReportFixture = {
  policy: {
    staleAfterHours: 24
  },
  summary: {
    totalPreviews: 2,
    activePreviews: 1,
    inSync: 0,
    drifted: 1,
    stale: 1,
    unmanaged: 0,
    gcEligible: 1
  },
  previews: [
    {
      key: "pr-41",
      target: "pull-request",
      branch: "feature/stale-preview",
      pullRequestNumber: 41,
      envBranch: "preview/pr-41",
      stackName: "console-pr-41",
      primaryDomain: "preview-41.example.test",
      latestDeploymentId: "dep_preview_41",
      latestAction: "deploy",
      latestStatus: "healthy",
      latestStatusLabel: "Completed",
      latestStatusTone: "healthy",
      lastRequestedAt: "2026-03-28T18:00:00.000Z",
      lastFinishedAt: "2026-03-28T18:02:00.000Z",
      isActive: true,
      desiredDomain: "preview-41.example.test",
      domainStatus: "matched",
      reconciliationStatus: "stale",
      staleAt: "2026-03-28T19:00:00.000Z",
      isStale: true,
      staleReason: "retention-window-expired",
      gcEligible: true,
      observedRoute: {
        hostname: "preview-41.example.test",
        service: "http://console-pr-41:3000",
        path: null,
        status: "active",
        tunnelId: "tunnel_1",
        tunnelName: "Preview Tunnel"
      }
    },
    {
      key: "pr-42",
      target: "pull-request",
      branch: "feature/drifted-preview",
      pullRequestNumber: 42,
      envBranch: "preview/pr-42",
      stackName: "console-pr-42",
      primaryDomain: "preview-42.example.test",
      latestDeploymentId: "dep_preview_42",
      latestAction: "deploy",
      latestStatus: "failed",
      latestStatusLabel: "Failed",
      latestStatusTone: "failed",
      lastRequestedAt: "2026-03-28T20:00:00.000Z",
      lastFinishedAt: "2026-03-28T20:05:00.000Z",
      isActive: false,
      desiredDomain: "preview-42.example.test",
      domainStatus: "missing",
      reconciliationStatus: "drifted",
      staleAt: "2026-03-29T20:00:00.000Z",
      isStale: false,
      staleReason: null,
      gcEligible: false,
      observedRoute: null
    }
  ]
};

describe("PreviewLifecyclePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    composePreviewReconciliationUseQueryMock.mockReturnValue({
      isLoading: false,
      data: previewReportFixture
    });
    useUtilsMock.mockReturnValue({
      composePreviewReconciliation: {
        invalidate: invalidateComposePreviewReconciliationMock
      },
      composePreviews: {
        invalidate: invalidateComposePreviewsMock
      },
      serviceDetails: {
        invalidate: invalidateServiceDetailsMock
      }
    });
    reconcileComposePreviewsUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: reconcileMutateAsyncMock
    });
    triggerDeployUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: triggerDeployMutateAsyncMock
    });
    reconcileMutateAsyncMock.mockResolvedValue({
      execution: {
        gcCandidates: 1,
        gcQueued: 1
      }
    });
    triggerDeployMutateAsyncMock.mockResolvedValue({
      id: "dep_cleanup_41"
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderPanel(canManagePreviews = true, canReadPreviews = true) {
    return render(
      <PreviewLifecyclePanel
        serviceId="svc_preview"
        serviceName="console"
        canReadPreviews={canReadPreviews}
        canManagePreviews={canManagePreviews}
        previewConfig={{
          enabled: true,
          mode: "pull-request",
          domainTemplate: "preview-{pr}.example.test",
          staleAfterHours: 24
        }}
      />
    );
  }

  it("renders preview lifecycle summaries, reasons, and tracked previews", () => {
    renderPanel();

    expect(screen.getByTestId("service-preview-mode-svc_preview")).toHaveTextContent(
      "Pull requests only"
    );
    expect(screen.getByTestId("service-preview-summary-total-svc_preview")).toHaveTextContent("2");
    expect(screen.getByTestId("service-preview-summary-cleanup-svc_preview")).toHaveTextContent(
      "1"
    );
    expect(screen.getByTestId("service-preview-item-svc_preview-pr-41")).toHaveTextContent(
      "Cleanup due"
    );
    expect(screen.getByTestId("service-preview-item-svc_preview-pr-42")).toHaveTextContent(
      "DaoFlow expects preview-42.example.test, but no active route is attached yet."
    );
  });

  it("runs preview cleanup planning and refreshes preview state", async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("service-preview-dry-run-svc_preview"));

    await waitFor(() => {
      expect(reconcileMutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_preview",
        dryRun: true
      });
    });
    expect(await screen.findByTestId("service-preview-feedback-svc_preview")).toHaveTextContent(
      "1 preview environment is ready for cleanup."
    );
    expect(invalidateComposePreviewReconciliationMock).toHaveBeenCalledWith({
      serviceId: "svc_preview"
    });
    expect(invalidateComposePreviewsMock).toHaveBeenCalledWith({
      serviceId: "svc_preview"
    });
    expect(invalidateServiceDetailsMock).toHaveBeenCalledWith({
      serviceId: "svc_preview"
    });
  });

  it("queues manual preview retirement for active previews", async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("service-preview-retire-svc_preview-pr-41"));

    await waitFor(() => {
      expect(triggerDeployMutateAsyncMock).toHaveBeenCalledWith({
        serviceId: "svc_preview",
        preview: {
          target: "pull-request",
          branch: "feature/stale-preview",
          pullRequestNumber: 41,
          action: "destroy"
        }
      });
    });
    expect(await screen.findByTestId("service-preview-feedback-svc_preview")).toHaveTextContent(
      "Queued cleanup for preview pr-41."
    );
  });

  it("hides management actions for viewers without deploy access", () => {
    renderPanel(false);

    expect(screen.queryByTestId("service-preview-dry-run-svc_preview")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("service-preview-retire-svc_preview-pr-41")
    ).not.toBeInTheDocument();
  });

  it("shows an access notice instead of a failed preview query for viewers without deploy read access", () => {
    renderPanel(false, false);

    expect(screen.getByTestId("service-preview-panel-access-svc_preview")).toHaveTextContent(
      "Preview lifecycle needs deployment read access."
    );
    expect(composePreviewReconciliationUseQueryMock).toHaveBeenCalledWith(
      { serviceId: "svc_preview" },
      { enabled: false }
    );
  });
});
