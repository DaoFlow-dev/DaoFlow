import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agent-safe command gates
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Approval queue</h2>
      </div>

      {displayedFeedback ? (
        <p
          className="rounded-lg border border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
          data-testid="approval-feedback"
        >
          {displayedFeedback}
        </p>
      ) : null}

      {session.data && approvalQueue.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="approval-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Requests
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {approvalQueue.data.summary.totalRequests}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pending
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {approvalQueue.data.summary.pendingRequests}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Approved
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {approvalQueue.data.summary.approvedRequests}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Critical
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {approvalQueue.data.summary.criticalRequests}
              </strong>
            </Card>
          </div>

          <div className="space-y-3">
            {approvalQueue.data.requests.map((request) => (
              <Card className="p-5" data-testid={`approval-request-${request.id}`} key={request.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {request.requestedBy} · {request.requestedByRole}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {request.actionType}
                    </h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(request.statusTone)}>
                    {request.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {request.resourceLabel} · Risk: {request.riskLevel}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{request.reason}</p>
                <p className="mt-2 text-sm text-muted-foreground">{request.commandSummary}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Requested: {request.requestedAt} · Expires: {request.expiresAt}
                </p>
                {request.decidedBy ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Decision: {request.decidedBy} · {request.decidedAt}
                  </p>
                ) : null}
                <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  {request.recommendedChecks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
                {canOperateExecutionJobs && request.status === "pending" ? (
                  <div className="mt-4 flex gap-2">
                    <Button
                      disabled={approvalMutationPending}
                      onClick={() => {
                        void handleApproveApproval(request.id, request.resourceLabel);
                      }}
                    >
                      {approvalMutationPending ? "Applying..." : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={approvalMutationPending}
                      onClick={() => {
                        void handleRejectApproval(request.id, request.resourceLabel);
                      }}
                    >
                      {approvalMutationPending ? "Applying..." : "Reject"}
                    </Button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {approvalMessage ?? "Sign in to inspect high-risk actions waiting for human approval."}
        </p>
      )}
    </section>
  );
}
