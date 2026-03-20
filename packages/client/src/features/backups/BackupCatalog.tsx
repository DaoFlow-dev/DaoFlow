import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { getBackupOperationTone } from "@/lib/tone-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface BackupPolicy {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  storageProvider: string;
  scheduleLabel: string | null;
  retentionCount: number;
}

interface BackupRun {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  triggerKind: string;
  status: string;
  statusTone?: string;
  requestedBy: string;
  artifactPath: string | null;
}

interface RestoreRequest {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  status: string;
  statusTone?: string;
  destinationServerName: string;
  restorePath: string | null;
  sourceArtifactPath: string | null;
  validationSummary: string | null;
}

interface BackupOverviewData {
  summary: {
    totalPolicies: number;
    queuedRuns: number;
    succeededRuns: number;
    failedRuns: number;
  };
  policies: BackupPolicy[];
  runs: BackupRun[];
}

interface BackupRestoreQueueData {
  summary: {
    totalRequests: number;
    queuedRequests: number;
    succeededRequests: number;
    failedRequests: number;
  };
  requests: RestoreRequest[];
}

export interface BackupCatalogProps {
  session: { data: unknown };
  backupOverview: { data?: BackupOverviewData };
  backupRestoreQueue: { data?: BackupRestoreQueueData };
  backupMessage: string | null;
  backupRestoreMessage: string | null;
  canOperateExecutionJobs: boolean;
  canRequestApprovals: boolean;
  refreshOperationalViews: () => Promise<void>;
  onApprovalFeedback: (msg: string) => void;
}

export function BackupCatalog({
  session,
  backupOverview,
  backupRestoreQueue,
  backupMessage,
  backupRestoreMessage,
  canOperateExecutionJobs,
  canRequestApprovals,
  refreshOperationalViews,
  onApprovalFeedback
}: BackupCatalogProps) {
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [backupRestoreFeedback, setBackupRestoreFeedback] = useState<string | null>(null);
  const triggerBackupRun = trpc.triggerBackupRun.useMutation();
  const queueBackupRestore = trpc.queueBackupRestore.useMutation();
  const requestApproval = trpc.requestApproval.useMutation();

  async function handleTriggerBackupRun(policyId: string, service: string) {
    setBackupFeedback(null);

    try {
      await triggerBackupRun.mutateAsync({
        policyId
      });
      await refreshOperationalViews();
      setBackupFeedback(`Queued backup run for ${service}.`);
    } catch (error) {
      setBackupFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the backup run right now."
      );
    }
  }

  async function handleQueueBackupRestore(backupRunId: string, service: string) {
    setBackupRestoreFeedback(null);

    try {
      await queueBackupRestore.mutateAsync({
        backupRunId
      });
      await refreshOperationalViews();
      setBackupRestoreFeedback(`Queued restore drill for ${service}.`);
    } catch (error) {
      setBackupRestoreFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the restore drill right now."
      );
    }
  }

  async function handleRequestBackupRestoreApproval(backupRunId: string, service: string) {
    onApprovalFeedback("");

    try {
      const request = await requestApproval.mutateAsync({
        actionType: "backup-restore",
        backupRunId,
        reason: "Require an operator checkpoint before replaying this restore drill."
      });
      await refreshOperationalViews();
      onApprovalFeedback(`Requested approval for ${request.actionType} on ${service}.`);
    } catch (error) {
      onApprovalFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to request approval for this restore drill right now."
      );
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Backup awareness
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Backup policies and runs
        </h2>
      </div>

      {session.data && backupOverview.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="backup-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Policies
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {backupOverview.data.summary.totalPolicies}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Queued
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {backupOverview.data.summary.queuedRuns}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Succeeded
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {backupOverview.data.summary.succeededRuns}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Failed
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {backupOverview.data.summary.failedRuns}
              </strong>
            </Card>
          </div>

          {backupFeedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="backup-feedback"
            >
              {backupFeedback}
            </p>
          ) : null}
          {backupRestoreFeedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="restore-feedback"
            >
              {backupRestoreFeedback}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {backupOverview.data.policies.map((policy) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`backup-policy-${policy.id}`}
                key={policy.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {policy.environmentName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {policy.serviceName}
                    </h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone("queued")}>{policy.targetType}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {policy.storageProvider} · {policy.scheduleLabel}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Retention: {policy.retentionCount} snapshots
                </p>
                {canOperateExecutionJobs ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={triggerBackupRun.isPending}
                      onClick={() => {
                        void handleTriggerBackupRun(policy.id, policy.serviceName);
                      }}
                      type="button"
                    >
                      Queue backup
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {backupOverview.data.runs.map((run) => {
              const statusTone = run.statusTone ?? getBackupOperationTone(run.status);

              return (
                <article
                  className="rounded-xl border bg-card p-5 shadow-sm"
                  data-testid={`backup-run-${run.id}`}
                  key={run.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {run.environmentName} · {run.triggerKind}
                      </p>
                      <h3 className="text-base font-semibold text-foreground">{run.serviceName}</h3>
                    </div>
                    <Badge variant={getBadgeVariantFromTone(statusTone)}>{run.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {run.targetType} backup · Requested by {run.requestedBy}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {run.artifactPath ??
                      "Artifact path will be assigned by the future backup worker."}
                  </p>
                  {(canOperateExecutionJobs || canRequestApprovals) &&
                  run.status === "succeeded" &&
                  run.artifactPath ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canOperateExecutionJobs ? (
                        <Button
                          variant="outline"
                          disabled={queueBackupRestore.isPending}
                          onClick={() => {
                            void handleQueueBackupRestore(run.id, run.serviceName);
                          }}
                          type="button"
                        >
                          Queue restore
                        </Button>
                      ) : null}
                      {canRequestApprovals ? (
                        <Button
                          disabled={requestApproval.isPending}
                          onClick={() => {
                            void handleRequestBackupRestoreApproval(run.id, run.serviceName);
                          }}
                          type="button"
                        >
                          {requestApproval.isPending ? "Requesting..." : "Request approval"}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {backupRestoreQueue.data ? (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recovery drills
                </p>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Backup restore queue
                </h2>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-3" data-testid="restore-summary">
                <Card className="p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Requests
                  </span>
                  <strong className="mt-1 block text-2xl font-bold">
                    {backupRestoreQueue.data.summary.totalRequests}
                  </strong>
                </Card>
                <Card className="p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Queued
                  </span>
                  <strong className="mt-1 block text-2xl font-bold">
                    {backupRestoreQueue.data.summary.queuedRequests}
                  </strong>
                </Card>
                <Card className="p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Succeeded
                  </span>
                  <strong className="mt-1 block text-2xl font-bold">
                    {backupRestoreQueue.data.summary.succeededRequests}
                  </strong>
                </Card>
                <Card className="p-4">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Failed
                  </span>
                  <strong className="mt-1 block text-2xl font-bold">
                    {backupRestoreQueue.data.summary.failedRequests}
                  </strong>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {backupRestoreQueue.data.requests.map((request) => {
                  const statusTone = request.statusTone ?? getBackupOperationTone(request.status);

                  return (
                    <article
                      className="rounded-xl border bg-card p-5 shadow-sm"
                      data-testid={`backup-restore-${request.id}`}
                      key={request.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {request.environmentName} · {request.targetType}
                          </p>
                          <h3 className="text-base font-semibold text-foreground">
                            {request.serviceName}
                          </h3>
                        </div>
                        <Badge variant={getBadgeVariantFromTone(statusTone)}>
                          {request.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Restore to {request.destinationServerName}:{request.restorePath}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {request.sourceArtifactPath}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {request.validationSummary}
                      </p>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {backupRestoreMessage ?? "Sign in to inspect queued and historical restore drills."}
            </p>
          )}
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {backupMessage ?? "Sign in to inspect backup policies and recent runs."}
        </p>
      )}
    </section>
  );
}
