// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupsPage from "./BackupsPage";

const {
  backupOverviewUseQueryMock,
  backupRunDetailsUseQueryMock,
  enableBackupScheduleUseMutationMock,
  disableBackupScheduleUseMutationMock,
  triggerBackupNowUseMutationMock,
  refetchBackupRunDetailsMock
} = vi.hoisted(() => ({
  backupOverviewUseQueryMock: vi.fn(),
  backupRunDetailsUseQueryMock: vi.fn(),
  enableBackupScheduleUseMutationMock: vi.fn(),
  disableBackupScheduleUseMutationMock: vi.fn(),
  triggerBackupNowUseMutationMock: vi.fn(),
  refetchBackupRunDetailsMock: vi.fn()
}));

vi.mock("../lib/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        id: "user_1"
      }
    }
  })
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    backupOverview: {
      useQuery: backupOverviewUseQueryMock
    },
    backupRunDetails: {
      useQuery: backupRunDetailsUseQueryMock
    },
    enableBackupSchedule: {
      useMutation: enableBackupScheduleUseMutationMock
    },
    disableBackupSchedule: {
      useMutation: disableBackupScheduleUseMutationMock
    },
    triggerBackupNow: {
      useMutation: triggerBackupNowUseMutationMock
    }
  }
}));

describe("BackupsPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    refetchBackupRunDetailsMock.mockReset();
    backupOverviewUseQueryMock.mockReturnValue({
      data: {
        policies: [],
        runs: [
          {
            id: "run_failed",
            policyId: "policy_1",
            projectName: "DaoFlow",
            environmentName: "production",
            serviceName: "postgres",
            targetType: "volume",
            status: "failed",
            statusTone: "failed",
            triggerKind: "scheduled",
            requestedBy: "scheduler",
            artifactPath: null,
            bytesWritten: null,
            startedAt: "2026-03-20T02:00:00.000Z",
            finishedAt: "2026-03-20T02:07:00.000Z"
          }
        ]
      },
      isLoading: false,
      refetch: vi.fn()
    });
    backupRunDetailsUseQueryMock.mockImplementation((input: { runId: string }) => {
      if (input.runId === "run_failed") {
        return {
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
          refetch: refetchBackupRunDetailsMock
        };
      }

      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: refetchBackupRunDetailsMock
      };
    });
    enableBackupScheduleUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    disableBackupScheduleUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
    triggerBackupNowUseMutationMock.mockReturnValue({ isPending: false, mutate: vi.fn() });
  });

  it("opens the backup run details sheet from the runs table", () => {
    render(<BackupsPage />);

    fireEvent.click(screen.getByTestId("backup-run-inspect-run_failed"));

    expect(screen.getByTestId("backup-run-details-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("backup-run-details-title")).toHaveTextContent("postgres");
    expect(
      screen.getByText("Resolved policy control-plane-db for foundation-vps-1.")
    ).toBeVisible();
  });
});
