// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServersPage from "./ServersPage";

const {
  registerServerUseMutationMock,
  retryServerReadinessMock,
  serverReadinessUseQueryMock,
  viewerUseQueryMock
} = vi.hoisted(() => ({
  registerServerUseMutationMock: vi.fn(),
  retryServerReadinessMock: vi.fn(),
  serverReadinessUseQueryMock: vi.fn(),
  viewerUseQueryMock: vi.fn()
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
      serverReadiness: {
        invalidate: vi.fn()
      }
    }),
    serverReadiness: {
      useQuery: serverReadinessUseQueryMock
    },
    viewer: {
      useQuery: viewerUseQueryMock
    },
    registerServer: {
      useMutation: registerServerUseMutationMock
    }
  }
}));

describe("ServersPage load states", () => {
  beforeEach(() => {
    retryServerReadinessMock.mockReset();
    serverReadinessUseQueryMock.mockReturnValue({
      data: {
        checks: [],
        summary: null
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: retryServerReadinessMock
    });
    viewerUseQueryMock.mockReturnValue({
      data: {
        authz: {
          capabilities: []
        }
      }
    });
    registerServerUseMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a retryable readiness error instead of the empty server state", () => {
    serverReadinessUseQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("server readiness unavailable"),
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: retryServerReadinessMock
    });

    render(
      <MemoryRouter initialEntries={["/servers"]}>
        <ServersPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("server readiness unavailable");
    expect(screen.queryByText("No servers registered")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retryServerReadinessMock).toHaveBeenCalledTimes(1);
  });
});
