// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupCatalog } from "./BackupCatalog";

const {
  triggerBackupNowUseMutationMock,
  queueBackupRestoreUseMutationMock,
  requestApprovalUseMutationMock
} = vi.hoisted(() => ({
  triggerBackupNowUseMutationMock: vi.fn(),
  queueBackupRestoreUseMutationMock: vi.fn(),
  requestApprovalUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    triggerBackupNow: {
      useMutation: triggerBackupNowUseMutationMock
    },
    queueBackupRestore: {
      useMutation: queueBackupRestoreUseMutationMock
    },
    requestApproval: {
      useMutation: requestApprovalUseMutationMock
    }
  }
}));

const backupOverview = {
  summary: {
    totalPolicies: 1,
    queuedRuns: 2,
    succeededRuns: 3,
    failedRuns: 4
  },
  policies: [
    {
      id: "policy_1",
      serviceName: "api",
      environmentName: "production",
      targetType: "volume",
      storageProvider: "s3",
      scheduleLabel: "0 2 * * *",
      retentionCount: 14
    }
  ],
  runs: [
    {
      id: "run_1",
      serviceName: "api",
      environmentName: "production",
      targetType: "volume",
      triggerKind: "manual",
      status: "succeeded",
      requestedBy: "operator",
      artifactPath: "s3://prod/run_1.tar.zst"
    }
  ]
};

const backupRestoreQueue = {
  summary: {
    totalRequests: 1,
    queuedRequests: 0,
    succeededRequests: 1,
    failedRequests: 0
  },
  requests: [
    {
      id: "restore_1",
      serviceName: "api",
      environmentName: "production",
      targetType: "volume",
      status: "succeeded",
      destinationServerName: "foundation-1",
      restorePath: "/var/lib/app",
      sourceArtifactPath: "s3://prod/run_1.tar.zst",
      validationSummary: "Checksum verified."
    }
  ]
};

describe("BackupCatalog", () => {
  const refreshOperationalViews = vi.fn().mockResolvedValue(undefined);
  const onApprovalFeedback = vi.fn();

  beforeEach(() => {
    refreshOperationalViews.mockClear();
    onApprovalFeedback.mockClear();

    triggerBackupNowUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ id: "job_1" })
    });
    queueBackupRestoreUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ id: "restore_queued" })
    });
    requestApprovalUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ actionType: "backup-restore" })
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderCatalog() {
    return render(
      <BackupCatalog
        session={{ data: { user: { id: "user_1" } } }}
        backupOverview={{ data: backupOverview }}
        backupRestoreQueue={{ data: backupRestoreQueue }}
        backupMessage={null}
        backupRestoreMessage={null}
        canOperateExecutionJobs={true}
        canRequestApprovals={true}
        refreshOperationalViews={refreshOperationalViews}
        onApprovalFeedback={onApprovalFeedback}
      />
    );
  }

  it("renders summary cards and backup entities from the provided data", () => {
    renderCatalog();

    expect(screen.getByTestId("backup-summary")).toHaveTextContent("Policies");
    expect(screen.getByTestId("backup-policy-policy_1")).toHaveTextContent("api");
    expect(screen.getByTestId("backup-run-run_1")).toHaveTextContent("Requested by operator");
    expect(screen.getByTestId("restore-summary")).toHaveTextContent("Requests");
    expect(screen.getByTestId("backup-restore-restore_1")).toHaveTextContent("Checksum verified.");
  });

  it("queues backup, restore, and approval actions while preserving operator feedback", async () => {
    const triggerBackup = vi.fn().mockResolvedValue({ id: "job_1" });
    const queueRestore = vi.fn().mockResolvedValue({ id: "restore_queued" });
    const requestApproval = vi.fn().mockResolvedValue({ actionType: "backup-restore" });

    triggerBackupNowUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: triggerBackup
    });
    queueBackupRestoreUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: queueRestore
    });
    requestApprovalUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: requestApproval
    });

    renderCatalog();

    fireEvent.click(screen.getByRole("button", { name: "Queue backup" }));
    await waitFor(() => {
      expect(triggerBackup).toHaveBeenCalledWith({ policyId: "policy_1" });
    });
    expect(await screen.findByTestId("backup-feedback")).toHaveTextContent(
      "Queued Temporal backup run for api."
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue restore" }));
    await waitFor(() => {
      expect(queueRestore).toHaveBeenCalledWith({ backupRunId: "run_1" });
    });
    expect(await screen.findByTestId("restore-feedback")).toHaveTextContent(
      "Queued restore drill for api."
    );

    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    await waitFor(() => {
      expect(requestApproval).toHaveBeenCalledWith({
        actionType: "backup-restore",
        backupRunId: "run_1",
        reason: "Require an operator checkpoint before replaying this restore drill."
      });
    });
    expect(onApprovalFeedback).toHaveBeenLastCalledWith(
      "Requested approval for backup-restore on api."
    );
    expect(refreshOperationalViews).toHaveBeenCalledTimes(3);
  });
});
