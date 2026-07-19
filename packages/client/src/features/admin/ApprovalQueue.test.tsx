// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "./ApprovalQueue";

const {
  approveApprovalRequestUseMutationMock,
  rejectApprovalRequestUseMutationMock,
  retryApprovalActionDispatchUseMutationMock
} = vi.hoisted(() => ({
  approveApprovalRequestUseMutationMock: vi.fn(),
  rejectApprovalRequestUseMutationMock: vi.fn(),
  retryApprovalActionDispatchUseMutationMock: vi.fn()
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    approveApprovalRequest: { useMutation: approveApprovalRequestUseMutationMock },
    rejectApprovalRequest: { useMutation: rejectApprovalRequestUseMutationMock },
    retryApprovalActionDispatch: { useMutation: retryApprovalActionDispatchUseMutationMock }
  }
}));

describe("ApprovalQueue", () => {
  beforeEach(() => {
    approveApprovalRequestUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
    rejectApprovalRequestUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
    retryApprovalActionDispatchUseMutationMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows durable dispatch progress, operation ID, attempts, and terminal errors", () => {
    render(
      <ApprovalQueue
        session={{ data: { user: { id: "user_1" } } }}
        approvalQueue={{
          data: {
            summary: {
              totalRequests: 1,
              pendingRequests: 0,
              approvedRequests: 1,
              criticalRequests: 0
            },
            requests: [
              {
                id: "apr_240",
                actionType: "backup-restore",
                status: "approved",
                statusTone: "healthy",
                riskLevel: "critical",
                resourceLabel: "postgres@production",
                reason: "Replay a verified backup after a failed migration.",
                commandSummary: "Restore the approved backup.",
                requestedBy: "owner@daoflow.local",
                requestedByRole: "owner",
                requestedAt: "2026-07-18T12:00:00.000Z",
                expiresAt: "2026-07-18T19:00:00.000Z",
                decidedBy: "ops@daoflow.local",
                decidedAt: "2026-07-18T12:30:00.000Z",
                recommendedChecks: [],
                dispatchStatus: "terminal-failure",
                dispatchStatusLabel: "terminal failure",
                dispatchStatusTone: "failed",
                operationId: "op_restore_240",
                dispatchAttempts: 5,
                dispatchError: "Restore target no longer belongs to this team.",
                dispatchNextAttemptAt: null,
                dispatchedAt: null,
                dispatchCompletedAt: "2026-07-18T12:32:00.000Z"
              }
            ]
          }
        }}
        approvalMessage={null}
        canOperateExecutionJobs={true}
        refreshOperationalViews={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByTestId("approval-dispatch-apr_240")).toHaveTextContent("Durable dispatch");
    expect(screen.getByTestId("approval-dispatch-status-apr_240")).toHaveTextContent(
      "terminal failure"
    );
    expect(screen.getByTestId("approval-operation-id-apr_240")).toHaveTextContent("op_restore_240");
    expect(screen.getByTestId("approval-dispatch-attempts-apr_240")).toHaveTextContent("5");
    expect(screen.getByTestId("approval-dispatch-error-apr_240")).toHaveTextContent(
      "Restore target no longer belongs to this team."
    );
    expect(screen.getByTestId("approval-dispatch-retry-apr_240")).toHaveTextContent(
      "Retry dispatch"
    );
  });
});
