import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";

interface ApprovalRequest {
  id: string;
  actionType: string;
  status: string;
  statusTone: string;
  riskLevel: string;
  resourceLabel: string;
  reason: string | null;
  commandSummary: string | null;
  requestedBy: string | null;
  requestedByRole: string | null;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  recommendedChecks: string[];
}

interface ApprovalQueueData {
  summary: {
    totalRequests: number;
    pendingRequests: number;
    approvedRequests: number;
    criticalRequests: number;
  };
  requests: ApprovalRequest[];
}

export interface ApprovalQueueProps {
  session: { data: unknown };
  approvalQueue: { data?: ApprovalQueueData };
  approvalMessage: string | null;
  canOperateExecutionJobs: boolean;
  refreshOperationalViews: () => Promise<void>;
  externalFeedback?: string | null;
}

export function ApprovalQueue({
  session,
  approvalQueue,
  approvalMessage,
  canOperateExecutionJobs,
  refreshOperationalViews,
  externalFeedback
}: ApprovalQueueProps) {
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);
  const approveApprovalRequest = trpc.approveApprovalRequest.useMutation();
  const rejectApprovalRequest = trpc.rejectApprovalRequest.useMutation();
  const approvalMutationPending =
    approveApprovalRequest.isPending || rejectApprovalRequest.isPending;

  async function handleApproveApproval(requestId: string, resourceLabel: string) {
    setApprovalFeedback(null);

    try {
      const request = await approveApprovalRequest.mutateAsync({
        requestId
      });
      await refreshOperationalViews();
      setApprovalFeedback(
        `Approved ${request?.actionType ?? "guarded action"} for ${resourceLabel}.`
      );
    } catch (error) {
      setApprovalFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to approve this guarded action right now."
      );
    }
  }

  async function handleRejectApproval(requestId: string, resourceLabel: string) {
    setApprovalFeedback(null);

    try {
      const request = await rejectApprovalRequest.mutateAsync({
        requestId
      });
      await refreshOperationalViews();
      setApprovalFeedback(
        `Rejected ${request?.actionType ?? "guarded action"} for ${resourceLabel}.`
      );
    } catch (error) {
      setApprovalFeedback(
        isTRPCClientError(error) ? error.message : "Unable to reject this guarded action right now."
      );
    }
  }

  const displayedFeedback = approvalFeedback ?? externalFeedback;

  return (
    <section className="approval-queue">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Agent-safe command gates</p>
        <h2>Approval queue</h2>
      </div>

      {displayedFeedback ? (
        <p className="auth-feedback" data-testid="approval-feedback">
          {displayedFeedback}
        </p>
      ) : null}

      {session.data && approvalQueue.data ? (
        <>
          <div className="approval-summary" data-testid="approval-summary">
            <div className="token-summary__item">
              <span className="metric__label">Requests</span>
              <strong>{approvalQueue.data.summary.totalRequests}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Pending</span>
              <strong>{approvalQueue.data.summary.pendingRequests}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Approved</span>
              <strong>{approvalQueue.data.summary.approvedRequests}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Critical</span>
              <strong>{approvalQueue.data.summary.criticalRequests}</strong>
            </div>
          </div>

          <div className="approval-list">
            {approvalQueue.data.requests.map((request) => (
              <article
                className="token-card"
                data-testid={`approval-request-${request.id}`}
                key={request.id}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {request.requestedBy} · {request.requestedByRole}
                    </p>
                    <h3>{request.actionType}</h3>
                  </div>
                  <span className={`deployment-status deployment-status--${request.statusTone}`}>
                    {request.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {request.resourceLabel} · Risk: {request.riskLevel}
                </p>
                <p className="deployment-card__meta">{request.reason}</p>
                <p className="deployment-card__meta">{request.commandSummary}</p>
                <p className="deployment-card__meta">
                  Requested: {request.requestedAt} · Expires: {request.expiresAt}
                </p>
                {request.decidedBy ? (
                  <p className="deployment-card__meta">
                    Decision: {request.decidedBy} · {request.decidedAt}
                  </p>
                ) : null}
                <ul className="deployment-card__steps">
                  {request.recommendedChecks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
                {canOperateExecutionJobs && request.status === "pending" ? (
                  <div className="job-actions">
                    <button
                      className="action-button"
                      disabled={approvalMutationPending}
                      onClick={() => {
                        void handleApproveApproval(request.id, request.resourceLabel);
                      }}
                      type="button"
                    >
                      {approvalMutationPending ? "Applying..." : "Approve"}
                    </button>
                    <button
                      className="action-button action-button--muted"
                      disabled={approvalMutationPending}
                      onClick={() => {
                        void handleRejectApproval(request.id, request.resourceLabel);
                      }}
                      type="button"
                    >
                      {approvalMutationPending ? "Applying..." : "Reject"}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {approvalMessage ?? "Sign in to inspect high-risk actions waiting for human approval."}
        </p>
      )}
    </section>
  );
}
