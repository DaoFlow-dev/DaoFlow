import {
  BackupOverviewSection,
  BackupRestoreQueueSection
} from "@/components/backups/BackupCatalogSections";
import type {
  BackupOverviewData,
  BackupRestoreQueueData
} from "@/components/backups/backup-catalog-types";
import { useBackupCatalogActions } from "@/features/backups/useBackupCatalogActions";

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
  const {
    backupFeedback,
    backupRestoreFeedback,
    triggerBackupRunPending,
    queueBackupRestorePending,
    requestApprovalPending,
    handleTriggerBackupRun,
    handleQueueBackupRestore,
    handleRequestBackupRestoreApproval
  } = useBackupCatalogActions({
    refreshOperationalViews,
    onApprovalFeedback
  });

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

          <BackupOverviewSection
            backupOverview={backupOverview.data}
            canOperateExecutionJobs={canOperateExecutionJobs}
            canRequestApprovals={canRequestApprovals}
            triggerBackupRunPending={triggerBackupRunPending}
            queueBackupRestorePending={queueBackupRestorePending}
            requestApprovalPending={requestApprovalPending}
            onTriggerBackupRun={handleTriggerBackupRun}
            onQueueBackupRestore={handleQueueBackupRestore}
            onRequestBackupRestoreApproval={handleRequestBackupRestoreApproval}
          />

          <BackupRestoreQueueSection
            backupRestoreQueue={backupRestoreQueue.data}
            backupRestoreMessage={backupRestoreMessage}
          />
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {backupMessage ?? "Sign in to inspect backup policies and recent runs."}
        </p>
      )}
    </section>
  );
}
