import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { getBackupOperationTone } from "../../lib/tone-utils";

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
  requestedBy: string;
  artifactPath: string | null;
}

interface RestoreRequest {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  status: string;
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
    <section className="backup-catalog">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Backup awareness</p>
        <h2>Backup policies and runs</h2>
      </div>

      {session.data && backupOverview.data ? (
        <>
          <div className="backup-summary" data-testid="backup-summary">
            <div className="token-summary__item">
              <span className="metric__label">Policies</span>
              <strong>{backupOverview.data.summary.totalPolicies}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Queued</span>
              <strong>{backupOverview.data.summary.queuedRuns}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Succeeded</span>
              <strong>{backupOverview.data.summary.succeededRuns}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Failed</span>
              <strong>{backupOverview.data.summary.failedRuns}</strong>
            </div>
          </div>

          {backupFeedback ? (
            <p className="auth-feedback" data-testid="backup-feedback">
              {backupFeedback}
            </p>
          ) : null}
          {backupRestoreFeedback ? (
            <p className="auth-feedback" data-testid="restore-feedback">
              {backupRestoreFeedback}
            </p>
          ) : null}

          <div className="backup-policy-list">
            {backupOverview.data.policies.map((policy) => (
              <article
                className="token-card"
                data-testid={`backup-policy-${policy.id}`}
                key={policy.id}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">{policy.environmentName}</p>
                    <h3>{policy.serviceName}</h3>
                  </div>
                  <span className="deployment-status deployment-status--queued">
                    {policy.targetType}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {policy.storageProvider} · {policy.scheduleLabel}
                </p>
                <p className="deployment-card__meta">
                  Retention: {policy.retentionCount} snapshots
                </p>
                {canOperateExecutionJobs ? (
                  <div className="job-actions">
                    <button
                      className="action-button"
                      disabled={triggerBackupRun.isPending}
                      onClick={() => {
                        void handleTriggerBackupRun(policy.id, policy.serviceName);
                      }}
                      type="button"
                    >
                      Queue backup
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="backup-run-list">
            {backupOverview.data.runs.map((run) => (
              <article className="timeline-event" data-testid={`backup-run-${run.id}`} key={run.id}>
                <div className="timeline-event__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {run.environmentName} · {run.triggerKind}
                    </p>
                    <h3>{run.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${getBackupOperationTone(run.status)}`}
                  >
                    {run.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {run.targetType} backup · Requested by {run.requestedBy}
                </p>
                <p className="deployment-card__meta">
                  {run.artifactPath ??
                    "Artifact path will be assigned by the future backup worker."}
                </p>
                {(canOperateExecutionJobs || canRequestApprovals) &&
                run.status === "succeeded" &&
                run.artifactPath ? (
                  <div className="job-actions">
                    {canOperateExecutionJobs ? (
                      <button
                        className="action-button action-button--muted"
                        disabled={queueBackupRestore.isPending}
                        onClick={() => {
                          void handleQueueBackupRestore(run.id, run.serviceName);
                        }}
                        type="button"
                      >
                        Queue restore
                      </button>
                    ) : null}
                    {canRequestApprovals ? (
                      <button
                        className="action-button"
                        disabled={requestApproval.isPending}
                        onClick={() => {
                          void handleRequestBackupRestoreApproval(run.id, run.serviceName);
                        }}
                        type="button"
                      >
                        {requestApproval.isPending ? "Requesting..." : "Request approval"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          {backupRestoreQueue.data ? (
            <>
              <div className="roadmap__header">
                <p className="roadmap__kicker">Recovery drills</p>
                <h2>Backup restore queue</h2>
              </div>

              <div className="restore-summary" data-testid="restore-summary">
                <div className="token-summary__item">
                  <span className="metric__label">Requests</span>
                  <strong>{backupRestoreQueue.data.summary.totalRequests}</strong>
                </div>
                <div className="token-summary__item">
                  <span className="metric__label">Queued</span>
                  <strong>{backupRestoreQueue.data.summary.queuedRequests}</strong>
                </div>
                <div className="token-summary__item">
                  <span className="metric__label">Succeeded</span>
                  <strong>{backupRestoreQueue.data.summary.succeededRequests}</strong>
                </div>
                <div className="token-summary__item">
                  <span className="metric__label">Failed</span>
                  <strong>{backupRestoreQueue.data.summary.failedRequests}</strong>
                </div>
              </div>

              <div className="restore-run-list">
                {backupRestoreQueue.data.requests.map((request) => (
                  <article
                    className="timeline-event"
                    data-testid={`backup-restore-${request.id}`}
                    key={request.id}
                  >
                    <div className="timeline-event__top">
                      <div>
                        <p className="roadmap-item__lane">
                          {request.environmentName} · {request.targetType}
                        </p>
                        <h3>{request.serviceName}</h3>
                      </div>
                      <span
                        className={`deployment-status deployment-status--${getBackupOperationTone(request.status)}`}
                      >
                        {request.status}
                      </span>
                    </div>
                    <p className="deployment-card__meta">
                      Restore to {request.destinationServerName}:{request.restorePath}
                    </p>
                    <p className="deployment-card__meta">{request.sourceArtifactPath}</p>
                    <p className="deployment-card__meta">{request.validationSummary}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="viewer-empty">
              {backupRestoreMessage ?? "Sign in to inspect queued and historical restore drills."}
            </p>
          )}
        </>
      ) : (
        <p className="viewer-empty">
          {backupMessage ?? "Sign in to inspect backup policies and recent runs."}
        </p>
      )}
    </section>
  );
}
