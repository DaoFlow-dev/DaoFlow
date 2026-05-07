// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RequestsPage from "./RequestsPage";

const { requestAccessLogsUseQueryMock, refetchMock } = vi.hoisted(() => ({
  requestAccessLogsUseQueryMock: vi.fn(),
  refetchMock: vi.fn()
}));

vi.mock("../lib/trpc", () => ({
  trpc: {
    requestAccessLogs: {
      useQuery: requestAccessLogsUseQueryMock
    }
  }
}));

describe("RequestsPage", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    requestAccessLogsUseQueryMock.mockReturnValue({
      isLoading: false,
      refetch: refetchMock,
      data: {
        summary: {
          totalRequests: 2,
          failedRequests: 0,
          deniedRequests: 1,
          apiTokenRequests: 1,
          webhookRequests: 0,
          slowRequests: 0
        },
        entries: [
          {
            id: "reqlog_1",
            requestId: "req_123",
            method: "GET",
            path: "/api/v1/images",
            category: "api",
            statusCode: 403,
            durationMs: 24,
            outcome: "denied",
            errorCategory: "scope_denied",
            authMethod: "api-token",
            actorLabel: "agent@daoflow.local",
            tokenLabel: "dfl_prefix...",
            sourceIp: "203.0.113.10",
            createdAt: "2026-03-29T12:00:00.000Z"
          }
        ]
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders request records and applies the failed auth filter", () => {
    render(<RequestsPage />);

    expect(screen.getByTestId("requests-page")).toBeInTheDocument();
    expect(screen.getByText("GET /api/v1/images")).toBeInTheDocument();
    expect(screen.getByText(/req_123/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /failed auth/i }));

    expect(requestAccessLogsUseQueryMock).toHaveBeenLastCalledWith({
      limit: 50,
      failedAuth: true,
      apiTokenOnly: undefined,
      webhooksOnly: undefined,
      slowMs: undefined
    });
  });
});
