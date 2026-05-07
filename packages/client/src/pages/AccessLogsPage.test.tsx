// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessLogsPage from "./AccessLogsPage";

const { accessLogsUseQueryMock } = vi.hoisted(() => ({
  accessLogsUseQueryMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    accessLogs: {
      useQuery: accessLogsUseQueryMock
    }
  }
}));

describe("AccessLogsPage", () => {
  const refetchMock = vi.fn();

  beforeEach(() => {
    refetchMock.mockReset();
    accessLogsUseQueryMock.mockReturnValue({
      data: {
        limit: 50,
        cursor: null,
        nextCursor: "2026-05-06T17:59:00.000Z",
        retentionDays: 30,
        summary: {
          totalEntries: 2,
          failedAuth: 1,
          deniedScopes: 1,
          webhookRequests: 1,
          apiTokenRequests: 1,
          slowRequests: 1,
          errorResponses: 0
        },
        entries: [
          {
            id: "rlog_1",
            requestId: "req-abc123",
            method: "POST",
            path: "/api/webhooks/github",
            category: "webhook",
            statusCode: 403,
            outcome: "denied",
            durationMs: 1200,
            actorEmail: "agent@token.daoflow.local",
            actorId: "principal_agent",
            actorType: "agent",
            tokenName: "agent-token",
            tokenPrefix: "dfl_agent_1",
            sourceIp: "203.0.113.10",
            userAgent: "daoflow-cli/0.8.7",
            errorCategory: "SCOPE_DENIED",
            requiredScopes: ["deploy:start"],
            grantedScopes: ["logs:read"],
            createdAt: "2026-05-06T18:00:00.000Z"
          }
        ]
      },
      isLoading: false,
      isError: false,
      refetch: refetchMock
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders request summary, rows, and redacted expanded details", () => {
    render(<AccessLogsPage />);

    expect(screen.getByTestId("access-logs-summary-failed-auth")).toHaveTextContent("1");
    expect(screen.getByTestId("access-log-path-rlog_1")).toHaveTextContent(
      "POST /api/webhooks/github"
    );
    expect(screen.getByTestId("access-log-status-rlog_1")).toHaveTextContent("403");

    fireEvent.click(screen.getByTestId("access-log-row-rlog_1"));

    expect(screen.getByTestId("access-log-details-rlog_1")).toHaveTextContent("SCOPE_DENIED");
    expect(screen.getByTestId("access-log-details-rlog_1")).toHaveTextContent("dfl_agent_1");
    expect(screen.getByTestId("access-log-details-rlog_1")).not.toHaveTextContent("Authorization");
  });

  it("passes search and status filters to the access log query", () => {
    render(<AccessLogsPage />);

    fireEvent.change(screen.getByTestId("access-logs-search"), {
      target: { value: "req-abc123" }
    });
    expect(accessLogsUseQueryMock).toHaveBeenLastCalledWith({
      limit: 50,
      cursor: undefined,
      status: undefined,
      search: "req-abc123"
    });
  });

  it("refreshes the access logs", () => {
    render(<AccessLogsPage />);

    fireEvent.click(screen.getByTestId("access-logs-refresh"));

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
