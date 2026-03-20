// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupsPage from "./BackupsPage";

const {
  backupOverviewUseQueryMock,
  backupDestinationsUseQueryMock,
  backupRunDetailsUseQueryMock,
  enableBackupScheduleUseMutationMock,
  disableBackupScheduleUseMutationMock,
  triggerBackupNowUseMutationMock,
  refetchBackupRunDetailsMock
} = vi.hoisted(() => ({
  backupOverviewUseQueryMock: vi.fn(),
  backupDestinationsUseQueryMock: vi.fn(),
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
    backupDestinations: {
      useQuery: backupDestinationsUseQueryMock
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
  function renderBackupsPage() {
    return render(
      <MemoryRouter>
        <BackupsPage />
      </MemoryRouter>
    );
  }

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
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dest_primary"
        }
      ],
      isLoading: false
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
    renderBackupsPage();

    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: false });
    fireEvent.click(screen.getByTestId("backup-run-inspect-run_failed"));

    expect(screen.getByTestId("backup-run-details-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("backup-run-details-title")).toHaveTextContent("postgres");
    expect(
      screen.getByText("Resolved policy control-plane-db for foundation-vps-1.")
    ).toBeVisible();
  });

  it("guides operators to configure destinations before policies when backups are empty", () => {
    backupOverviewUseQueryMock.mockReturnValue({
      data: {
        policies: [],
        runs: []
      },
      isLoading: false,
      refetch: vi.fn()
    });
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false
    });

    renderBackupsPage();

    expect(screen.getByTestId("backup-empty-state")).toBeInTheDocument();
    expect(screen.getByText("Add a backup destination first")).toBeVisible();
    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: true });
    expect(screen.getByTestId("backup-empty-open-destinations")).toHaveAttribute(
      "href",
      "/destinations"
    );
  });

  it("guides operators to create policies after destinations exist", () => {
    backupOverviewUseQueryMock.mockReturnValue({
      data: {
        policies: [],
        runs: []
      },
      isLoading: false,
      refetch: vi.fn()
    });
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dest_primary"
        }
      ],
      isLoading: false
    });

    renderBackupsPage();

    expect(screen.getByText("Backup destinations are ready")).toBeVisible();
    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: true });
    expect(
      screen.getByText(
        /Backup policies are the remaining setup step, and policies and run history will appear here after the first configuration\./i
      )
    ).toBeVisible();
    expect(screen.getByTestId("backup-empty-open-destinations")).toHaveTextContent(
      "Review Destination Inventory"
    );
    expect(screen.getByTestId("backup-empty-open-destinations")).toHaveAttribute(
      "href",
      "/destinations"
    );
  });

  it("waits for destination data before rendering the empty state", () => {
    backupOverviewUseQueryMock.mockReturnValue({
      data: {
        policies: [],
        runs: []
      },
      isLoading: false,
      refetch: vi.fn()
    });
    backupDestinationsUseQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true
    });

    renderBackupsPage();

    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: true });
    expect(screen.queryByTestId("backup-empty-state")).not.toBeInTheDocument();
  });
});
