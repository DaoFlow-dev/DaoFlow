// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupsTab from "./BackupsTab";

const {
  serviceBackupWorkflowUseQueryMock,
  backupRestorePlanUseQueryMock,
  triggerBackupNowUseMutationMock,
  queueBackupRestoreUseMutationMock
} = vi.hoisted(() => ({
  serviceBackupWorkflowUseQueryMock: vi.fn(),
  backupRestorePlanUseQueryMock: vi.fn(),
  triggerBackupNowUseMutationMock: vi.fn(),
  queueBackupRestoreUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    serviceBackupWorkflow: {
      useQuery: serviceBackupWorkflowUseQueryMock
    },
    backupRestorePlan: {
      useQuery: backupRestorePlanUseQueryMock
    },
    triggerBackupNow: {
      useMutation: triggerBackupNowUseMutationMock
    },
    queueBackupRestore: {
      useMutation: queueBackupRestoreUseMutationMock
    }
  }
}));

const workflowData = {
  summary: {
    totalVolumes: 1,
    protectedVolumes: 1,
    failedRuns: 1,
    restoreRequests: 1
  },
  volumes: [
    {
      id: "vol_api",
      volumeName: "api-data",
      mountPath: "/var/lib/api",
      sizeBytes: 2048,
      backupPolicyId: "pol_api",
      storageProvider: "s3",
      lastBackupAt: "2026-05-01T10:00:00.000Z",
      backupCoverage: "protected",
      restoreReadiness: "verified"
    }
  ],
  policies: [
    {
      id: "pol_api",
      name: "api daily",
      destinationName: "prod backups",
      backupType: "volume",
      schedule: "0 2 * * *",
      retentionDays: 14,
      lastRunAt: "2026-05-01T10:00:00.000Z"
    }
  ],
  runs: [
    {
      id: "run_ok",
      policyId: "pol_api",
      status: "succeeded",
      artifactPath: "s3:daoflow/api/run_ok",
      bytesWritten: 2048,
      finishedAt: "2026-05-01T10:03:00.000Z"
    },
    {
      id: "run_failed",
      policyId: "pol_api",
      status: "failed",
      artifactPath: null,
      bytesWritten: null,
      finishedAt: "2026-05-02T10:03:00.000Z"
    }
  ],
  restores: [
    {
      id: "restore_1",
      mode: "restore" as const,
      status: "succeeded",
      targetPath: "/var/lib/api",
      requestedBy: "owner@example.com",
      requestedAt: "2026-05-03T10:00:00.000Z"
    }
  ]
};

const restorePlan = {
  isReady: true,
  backupRun: {
    artifactPath: "s3:daoflow/api/run_ok"
  },
  target: {
    path: "/var/lib/api"
  },
  preflightChecks: [
    {
      status: "ok" as const,
      detail: "Resolved backup artifact s3:daoflow/api/run_ok."
    },
    {
      status: "warn" as const,
      detail: "This backup has not been verified by a test restore yet."
    }
  ]
};

describe("BackupsTab", () => {
  const workflowRefetch = vi.fn();
  const restoreRefetch = vi.fn();
  const triggerBackupMutate = vi.fn();
  const queueRestoreMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    workflowRefetch.mockResolvedValue({ data: workflowData });
    restoreRefetch.mockResolvedValue({ data: restorePlan });
    triggerBackupMutate.mockResolvedValue({});
    queueRestoreMutate.mockResolvedValue({});
    serviceBackupWorkflowUseQueryMock.mockReturnValue({
      data: workflowData,
      isLoading: false,
      error: null,
      refetch: workflowRefetch
    });
    backupRestorePlanUseQueryMock.mockImplementation((input: { backupRunId: string }) => ({
      data: input.backupRunId ? restorePlan : undefined,
      isLoading: false,
      error: null,
      refetch: restoreRefetch
    }));
    triggerBackupNowUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: triggerBackupMutate
    });
    queueBackupRestoreUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: queueRestoreMutate
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderTab() {
    return render(
      <MemoryRouter>
        <BackupsTab serviceId="svc_api" serviceName="api" />
      </MemoryRouter>
    );
  }

  it("shows volume backup status, retention, restore history, and failed run diagnostics", () => {
    renderTab();

    expect(screen.getByTestId("service-backups-total-volumes")).toHaveTextContent("1");
    expect(screen.getByTestId("service-backups-protected")).toHaveTextContent("1");
    expect(screen.getByTestId("service-backups-failed-runs")).toHaveTextContent("1");
    expect(screen.getByTestId("service-backups-volume-vol_api")).toHaveTextContent("api-data");
    expect(screen.getByTestId("service-backups-volume-vol_api")).toHaveTextContent("14 days");
    expect(screen.getByTestId("service-backups-run-row-run_failed")).toHaveTextContent("failed");
    expect(screen.getByTestId("service-backups-diagnostics-run_failed")).toHaveTextContent("Logs");
    expect(screen.getByTestId("service-backups-restore-restore_1")).toHaveTextContent(
      "owner@example.com"
    );
  });

  it("queues manual backups from the service policy", async () => {
    renderTab();

    fireEvent.click(screen.getByTestId("service-backups-run-pol_api"));

    await waitFor(() => {
      expect(triggerBackupMutate).toHaveBeenCalledWith({ policyId: "pol_api" });
    });
    expect(await screen.findByTestId("service-backups-feedback")).toHaveTextContent(
      "Queued backup for api daily."
    );
  });

  it("requires a restore preview before the restore action is available", async () => {
    renderTab();

    expect(screen.queryByTestId("service-backups-queue-restore-run_ok")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("service-backups-preview-restore-run_ok"));

    expect(await screen.findByTestId("service-backups-restore-preview")).toHaveTextContent(
      "/var/lib/api"
    );
    expect(screen.getByTestId("service-backups-restore-checks")).toHaveTextContent(
      "Resolved backup artifact"
    );

    fireEvent.click(screen.getByTestId("service-backups-queue-restore-run_ok"));

    await waitFor(() => {
      expect(queueRestoreMutate).toHaveBeenCalledWith({ backupRunId: "run_ok" });
    });
  });
});
