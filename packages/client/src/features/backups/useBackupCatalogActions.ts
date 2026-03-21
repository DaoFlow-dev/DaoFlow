import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";

interface UseBackupCatalogActionsOptions {
  refreshOperationalViews: () => Promise<void>;
  onApprovalFeedback: (msg: string) => void;
}

export function useBackupCatalogActions({
  refreshOperationalViews,
  onApprovalFeedback
}: UseBackupCatalogActionsOptions) {
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [backupRestoreFeedback, setBackupRestoreFeedback] = useState<string | null>(null);
  const triggerBackupRun = trpc.triggerBackupNow.useMutation();
  const queueBackupRestore = trpc.queueBackupRestore.useMutation();
  const requestApproval = trpc.requestApproval.useMutation();

  async function handleTriggerBackupRun(policyId: string, service: string) {
    setBackupFeedback(null);

    try {
      await triggerBackupRun.mutateAsync({ policyId });
      await refreshOperationalViews();
      setBackupFeedback(`Queued Temporal backup run for ${service}.`);
    } catch (error) {
      setBackupFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the backup run right now."
      );
    }
  }

  async function handleQueueBackupRestore(backupRunId: string, service: string) {
    setBackupRestoreFeedback(null);

    try {
      await queueBackupRestore.mutateAsync({ backupRunId });
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

  return {
    backupFeedback,
    backupRestoreFeedback,
    triggerBackupRunPending: triggerBackupRun.isPending,
    queueBackupRestorePending: queueBackupRestore.isPending,
    requestApprovalPending: requestApproval.isPending,
    handleTriggerBackupRun,
    handleQueueBackupRestore,
    handleRequestBackupRestoreApproval
  };
}
