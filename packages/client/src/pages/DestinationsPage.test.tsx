// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DestinationsPage from "./DestinationsPage";

const {
  backupDestinationsUseQueryMock,
  createBackupDestinationUseMutationMock,
  deleteBackupDestinationUseMutationMock,
  invalidateBackupDestinationsMock,
  refetchBackupDestinationsMock,
  testBackupDestinationUseMutationMock
} = vi.hoisted(() => ({
  backupDestinationsUseQueryMock: vi.fn(),
  createBackupDestinationUseMutationMock: vi.fn(),
  deleteBackupDestinationUseMutationMock: vi.fn(),
  invalidateBackupDestinationsMock: vi.fn(),
  refetchBackupDestinationsMock: vi.fn(),
  testBackupDestinationUseMutationMock: vi.fn()
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
    useUtils: () => ({
      backupDestinations: {
        invalidate: invalidateBackupDestinationsMock
      }
    }),
    backupDestinations: {
      useQuery: backupDestinationsUseQueryMock
    },
    createBackupDestination: {
      useMutation: createBackupDestinationUseMutationMock
    },
    deleteBackupDestination: {
      useMutation: deleteBackupDestinationUseMutationMock
    },
    testBackupDestination: {
      useMutation: testBackupDestinationUseMutationMock
    }
  }
}));

describe("DestinationsPage", () => {
  function renderDestinationsPage() {
    return render(
      <MemoryRouter initialEntries={["/destinations"]}>
        <DestinationsPage />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    refetchBackupDestinationsMock.mockReset();
    invalidateBackupDestinationsMock.mockReset();
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupDestinationsMock
    });
    createBackupDestinationUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
    deleteBackupDestinationUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
    testBackupDestinationUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the empty destination state when loading succeeds with no destinations", () => {
    renderDestinationsPage();

    expect(screen.getByText("No backup destinations configured")).toBeVisible();
    expect(screen.queryByTestId("destinations-load-error")).not.toBeInTheDocument();
  });

  it("shows a retryable load error instead of the empty destination state", () => {
    backupDestinationsUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("destinations unavailable"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupDestinationsMock
    });

    renderDestinationsPage();

    const errorPanel = screen.getByTestId("destinations-load-error");
    expect(errorPanel).toHaveTextContent("destinations unavailable");
    expect(screen.queryByText("No backup destinations configured")).not.toBeInTheDocument();

    fireEvent.click(within(errorPanel).getByRole("button", { name: "Retry" }));

    expect(refetchBackupDestinationsMock).toHaveBeenCalledTimes(1);
  });

  it("renders configured destinations after a successful load", () => {
    backupDestinationsUseQueryMock.mockReturnValue({
      data: [
        {
          id: "dest_1",
          name: "Production S3",
          provider: "s3",
          bucket: "prod-backups",
          region: "us-east-1",
          lastTestResult: "success",
          lastTestedAt: null
        }
      ],
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchBackupDestinationsMock
    });

    renderDestinationsPage();

    expect(screen.getByTestId("destination-row")).toHaveTextContent("Production S3");
    expect(screen.getByTestId("destination-row")).toHaveTextContent("prod-backups");
    expect(screen.queryByTestId("destinations-load-error")).not.toBeInTheDocument();
  });
});
