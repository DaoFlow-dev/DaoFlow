// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackupsPage from "./BackupsPage";

const {
  backupDestinationsUseQueryMock,
  backupOverviewUseQueryMock,
  backupRunDetailsUseQueryMock,
  queueBackupRestoreUseMutationMock,
  refetchBackupDestinationsMock,
  refetchBackupOverviewMock
} = vi.hoisted(() => ({
  backupDestinationsUseQueryMock: vi.fn(),
  backupOverviewUseQueryMock: vi.fn(),
  backupRunDetailsUseQueryMock: vi.fn(),
  queueBackupRestoreUseMutationMock: vi.fn(),
  refetchBackupDestinationsMock: vi.fn(),
  refetchBackupOverviewMock: vi.fn()
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
    backupDestinations: {
      useQuery: backupDestinationsUseQueryMock
    },
    backupOverview: {
      useQuery: backupOverviewUseQueryMock
    },
    backupRunDetails: {
      useQuery: backupRunDetailsUseQueryMock
    },
    queueBackupRestore: {
      useMutation: queueBackupRestoreUseMutationMock
    }
  }
}));

describe("BackupsPage load states", () => {
  function renderBackupsPage() {
    return render(
      <MemoryRouter initialEntries={["/backups"]}>
        <BackupsPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    refetchBackupDestinationsMock.mockReset();
    refetchBackupOverviewMock.mockReset();
    backupOverviewUseQueryMock.mockReturnValue({
      data: {
        policies: [],
        runs: []
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupOverviewMock
    });
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupDestinationsMock
    });
    backupRunDetailsUseQueryMock.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false
    });
    queueBackupRestoreUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a retryable backup overview error instead of the empty backup state", () => {
    backupOverviewUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("backup overview unavailable"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupOverviewMock
    });

    renderBackupsPage();

    const errorPanel = screen.getByTestId("backup-overview-load-error");
    expect(errorPanel).toHaveTextContent("backup overview unavailable");
    expect(screen.queryByTestId("backup-empty-state")).not.toBeInTheDocument();
    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: false });

    fireEvent.click(within(errorPanel).getByRole("button", { name: "Retry" }));

    expect(refetchBackupOverviewMock).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable backup destination error before setup guidance", () => {
    backupDestinationsUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("backup destinations unavailable"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupDestinationsMock
    });

    renderBackupsPage();

    const errorPanel = screen.getByTestId("backup-destinations-load-error");
    expect(errorPanel).toHaveTextContent("backup destinations unavailable");
    expect(screen.queryByTestId("backup-empty-state")).not.toBeInTheDocument();
    expect(backupDestinationsUseQueryMock).toHaveBeenCalledWith({}, { enabled: true });

    fireEvent.click(within(errorPanel).getByRole("button", { name: "Retry" }));

    expect(refetchBackupDestinationsMock).toHaveBeenCalledTimes(1);
  });
});
