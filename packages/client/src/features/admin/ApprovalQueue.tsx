import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
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
  dispatchStatus?: string | null;
  dispatchStatusLabel?: string | null;
  dispatchStatusTone?: string | null;
  operationId?: string | null;
  dispatchAttempts?: number;
  dispatchError?: string | null;
  dispatchNextAttemptAt?: string | null;
  dispatchedAt?: string | null;
  dispatchCompletedAt?: string | null;
  previewTrust?: {
    providerType: "github" | "gitlab";
    sourceRepository: string;
    commitSha: string;
    policy: string;
    policyRevision: number;
    allowedSecretProfile: string;
    origin: {
      repositoryRelationship: string;
      authorAssociation: string | null;
    };
  } | null;
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
  const retryApprovalActionDispatch = trpc.retryApprovalActionDispatch.useMutation();
  const approvalMutationPending =
    approveApprovalRequest.isPending ||
    rejectApprovalRequest.isPending ||
    retryApprovalActionDispatch.isPending;

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

  async function handleRetryApprovalDispatch(requestId: string, resourceLabel: string) {
    setApprovalFeedback(null);
    try {
      await retryApprovalActionDispatch.mutateAsync({ requestId });
      await refreshOperationalViews();
      setApprovalFeedback(`Requeued the approved operation for ${resourceLabel}.`);
    } catch (error) {
      setApprovalFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to requeue this approved operation right now."
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
                {request.previewTrust ? (
                  <section
                    className="mt-3 flex flex-col gap-1 rounded-md border border-border p-3 text-sm text-muted-foreground"
                    data-testid={`approval-preview-binding-${request.id}`}
                  >
                    <p className="font-medium text-foreground">Exact preview binding</p>
                    <p>
                      {request.previewTrust.providerType} · {request.previewTrust.sourceRepository}
                    </p>
                    <p className="font-mono text-xs">{request.previewTrust.commitSha}</p>
                    <p>
                      Policy {request.previewTrust.policy} · revision{" "}
                      {request.previewTrust.policyRevision}
                    </p>
                    <p>
                      Origin {request.previewTrust.origin.repositoryRelationship} · secrets profile{" "}
                      {request.previewTrust.allowedSecretProfile}
                    </p>
                  </section>
                ) : null}
                <p className="mt-2 text-sm text-muted-foreground">
                  Requested: {request.requestedAt} · Expires: {request.expiresAt}
                </p>
                {request.decidedBy ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Decision: {request.decidedBy} · {request.decidedAt}
                  </p>
                ) : null}
                {request.dispatchStatus ? (
                  <section
                    className="mt-3 rounded-md border border-border p-3 text-sm text-muted-foreground"
                    data-testid={`approval-dispatch-${request.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">Durable dispatch</p>
                      <Badge
                        data-testid={`approval-dispatch-status-${request.id}`}
                        variant={getBadgeVariantFromTone(request.dispatchStatusTone ?? "queued")}
                      >
                        {request.dispatchStatusLabel ?? request.dispatchStatus}
                      </Badge>
                    </div>
                    <p className="mt-2" data-testid={`approval-operation-id-${request.id}`}>
                      Operation: {request.operationId}
                    </p>
                    <p data-testid={`approval-dispatch-attempts-${request.id}`}>
                      Attempts: {request.dispatchAttempts ?? 0}
                    </p>
                    {request.dispatchNextAttemptAt ? (
                      <p data-testid={`approval-dispatch-next-attempt-${request.id}`}>
                        Next attempt: {request.dispatchNextAttemptAt}
                      </p>
                    ) : null}
                    {request.dispatchedAt ? (
                      <p data-testid={`approval-dispatched-at-${request.id}`}>
                        Submitted: {request.dispatchedAt}
                      </p>
                    ) : null}
                    {request.dispatchCompletedAt ? (
                      <p data-testid={`approval-dispatch-completed-at-${request.id}`}>
                        Completed: {request.dispatchCompletedAt}
                      </p>
                    ) : null}
                    {request.dispatchError ? (
                      <p
                        className="mt-2 text-destructive"
                        data-testid={`approval-dispatch-error-${request.id}`}
                      >
                        {request.dispatchError}
                      </p>
                    ) : null}
                    {canOperateExecutionJobs &&
                    request.dispatchStatus === "terminal-failure" &&
                    !request.dispatchedAt ? (
                      <Button
                        className="mt-3"
                        disabled={approvalMutationPending}
                        data-testid={`approval-dispatch-retry-${request.id}`}
                        onClick={() => {
                          void handleRetryApprovalDispatch(request.id, request.resourceLabel);
                        }}
                        variant="outline"
                      >
                        {approvalMutationPending ? "Applying..." : "Retry dispatch"}
                      </Button>
                    ) : null}
                  </section>
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
