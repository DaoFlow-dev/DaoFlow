// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupRunPage from "./BackupRunPage";

const { backupRunDetailsUseQueryMock } = vi.hoisted(() => ({
  backupRunDetailsUseQueryMock: vi.fn()
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1"
      }
    }
  })
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    backupRunDetails: {
      useQuery: backupRunDetailsUseQueryMock
    }
  }
}));

describe("BackupRunPage", () => {
  function renderBackupRunPage(initialEntry = "/backups/runs/run_failed") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/backups/runs/:runId" element={<BackupRunPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    backupRunDetailsUseQueryMock.mockReturnValue({
      data: {
        id: "run_failed",
        policyId: "policy_1",
        policyName: "postgres-volume",
        projectName: "DaoFlow",
        environmentName: "production",
        serviceName: "postgres",
        targetType: "volume",
        destinationName: "prod-backups",
        destinationProvider: "s3",
        destinationServerName: "foundation-vps-1",
        mountPath: "/var/lib/postgresql/data",
        backupType: "volume",
        databaseEngine: null,
        scheduleLabel: "0 2 * * *",
        retentionCount: 14,
        status: "failed",
        triggerKind: "scheduled",
        requestedBy: "scheduler",
        artifactPath: null,
        bytesWritten: null,
        checksum: null,
        verifiedAt: null,
        startedAt: "2026-03-20T02:00:00.000Z",
        finishedAt: "2026-03-20T02:07:00.000Z",
        error: "pg_dump lost the SSH transport before the archive uploaded.",
        restoreCount: 0,
        logsState: "available",
        logEntries: [
          {
            timestamp: "2026-03-20T02:00:00.000Z",
            level: "info",
            phase: "prepare",
            message: "Resolved policy control-plane-db for foundation-vps-1."
          }
        ]
      },
      isLoading: false,
      error: null,
      refetch: vi.fn()
    });
  });

  it("renders deep-linkable backup diagnostics for a failed run", () => {
    renderBackupRunPage();

    expect(backupRunDetailsUseQueryMock).toHaveBeenCalledWith(
      { runId: "run_failed" },
      { enabled: true }
    );
    expect(screen.getByTestId("backup-run-page-title")).toHaveTextContent("postgres");
    expect(screen.getByTestId("backup-run-page-status")).toHaveTextContent("failed");
    expect(screen.getByTestId("backup-run-page-back")).toHaveAttribute("href", "/backups");
    expect(screen.getByTestId("backup-run-page-run-id-card")).toHaveTextContent("run_failed");
    expect(
      screen.getByText("Resolved policy control-plane-db for foundation-vps-1.")
    ).toBeVisible();
  });
});
