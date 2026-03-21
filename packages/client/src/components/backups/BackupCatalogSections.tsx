import { getBackupOperationTone, getBadgeVariantFromTone } from "@/lib/tone-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  BackupOverviewData,
  BackupRestoreQueueData
} from "@/components/backups/backup-catalog-types";

interface SummaryItem {
  label: string;
  value: number;
}

interface BackupOverviewSectionProps {
  backupOverview: BackupOverviewData;
  canOperateExecutionJobs: boolean;
  canRequestApprovals: boolean;
  triggerBackupRunPending: boolean;
  queueBackupRestorePending: boolean;
  requestApprovalPending: boolean;
  onTriggerBackupRun: (policyId: string, serviceName: string) => Promise<void>;
  onQueueBackupRestore: (backupRunId: string, serviceName: string) => Promise<void>;
  onRequestBackupRestoreApproval: (backupRunId: string, serviceName: string) => Promise<void>;
}

interface BackupRestoreQueueSectionProps {
  backupRestoreQueue?: BackupRestoreQueueData;
  backupRestoreMessage: string | null;
}

function SummaryGrid({ items, testId }: { items: SummaryItem[]; testId: string }) {
  return (
    <div className="mb-3 grid grid-cols-4 gap-3" data-testid={testId}>
      {items.map((item) => (
        <Card className="p-4" key={item.label}>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {item.label}
          </span>
          <strong className="mt-1 block text-2xl font-bold">{item.value}</strong>
        </Card>
      ))}
    </div>
  );
}

export function BackupOverviewSection({
  backupOverview,
  canOperateExecutionJobs,
  canRequestApprovals,
  triggerBackupRunPending,
  queueBackupRestorePending,
  requestApprovalPending,
  onTriggerBackupRun,
  onQueueBackupRestore,
  onRequestBackupRestoreApproval
}: BackupOverviewSectionProps) {
  return (
    <>
      <SummaryGrid
        testId="backup-summary"
        items={[
          { label: "Policies", value: backupOverview.summary.totalPolicies },
          { label: "Queued", value: backupOverview.summary.queuedRuns },
          { label: "Succeeded", value: backupOverview.summary.succeededRuns },
          { label: "Failed", value: backupOverview.summary.failedRuns }
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        {backupOverview.policies.map((policy) => (
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
                <h3 className="text-base font-semibold text-foreground">{policy.serviceName}</h3>
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
                  disabled={triggerBackupRunPending}
                  onClick={() => {
                    void onTriggerBackupRun(policy.id, policy.serviceName);
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
        {backupOverview.runs.map((run) => {
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
                {run.artifactPath ?? "Artifact path will be assigned by the future backup worker."}
              </p>
              {(canOperateExecutionJobs || canRequestApprovals) &&
              run.status === "succeeded" &&
              run.artifactPath ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canOperateExecutionJobs ? (
                    <Button
                      disabled={queueBackupRestorePending}
                      onClick={() => {
                        void onQueueBackupRestore(run.id, run.serviceName);
                      }}
                      type="button"
                      variant="outline"
                    >
                      Queue restore
                    </Button>
                  ) : null}
                  {canRequestApprovals ? (
                    <Button
                      disabled={requestApprovalPending}
                      onClick={() => {
                        void onRequestBackupRestoreApproval(run.id, run.serviceName);
                      }}
                      type="button"
                    >
                      {requestApprovalPending ? "Requesting..." : "Request approval"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}

export function BackupRestoreQueueSection({
  backupRestoreQueue,
  backupRestoreMessage
}: BackupRestoreQueueSectionProps) {
  if (!backupRestoreQueue) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {backupRestoreMessage ?? "Sign in to inspect queued and historical restore drills."}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recovery drills
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Backup restore queue
        </h2>
      </div>

      <SummaryGrid
        testId="restore-summary"
        items={[
          { label: "Requests", value: backupRestoreQueue.summary.totalRequests },
          { label: "Queued", value: backupRestoreQueue.summary.queuedRequests },
          { label: "Succeeded", value: backupRestoreQueue.summary.succeededRequests },
          { label: "Failed", value: backupRestoreQueue.summary.failedRequests }
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        {backupRestoreQueue.requests.map((request) => {
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
                  <h3 className="text-base font-semibold text-foreground">{request.serviceName}</h3>
                </div>
                <Badge variant={getBadgeVariantFromTone(statusTone)}>{request.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Restore to {request.destinationServerName}:{request.restorePath}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{request.sourceArtifactPath}</p>
              <p className="mt-2 text-sm text-muted-foreground">{request.validationSummary}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
