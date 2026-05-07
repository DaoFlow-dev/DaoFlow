import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { HardDrive } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { BackupRestoreHistory, BackupRestorePreview } from "./BackupsTabRestore";
import { BackupPoliciesAndRuns, BackupSummaryGrid, BackupVolumesTable } from "./BackupsTabTables";
import type { BackupRestorePlan, ServiceBackupWorkflow } from "./backups-tab-types";

interface BackupsTabProps {
  serviceId: string;
  serviceName: string;
}

function useBackupFeedback() {
  const [message, setMessage] = useState<string | null>(null);

  return {
    message,
    clear: () => setMessage(null),
    setSuccess: (messageText: string) => setMessage(messageText),
    setError: (error: unknown, fallback: string) =>
      setMessage(isTRPCClientError(error) ? error.message : fallback)
  };
}

export default function BackupsTab({ serviceId, serviceName }: BackupsTabProps) {
  const feedback = useBackupFeedback();
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);
  const workflow = trpc.serviceBackupWorkflow.useQuery({ serviceId, limit: 12 });
  const restorePlan = trpc.backupRestorePlan.useQuery(
    { backupRunId: previewRunId ?? "" },
    { enabled: Boolean(previewRunId) }
  );
  const triggerBackup = trpc.triggerBackupNow.useMutation();
  const queueRestore = trpc.queueBackupRestore.useMutation();

  const data = workflow.data as ServiceBackupWorkflow | undefined;
  const plan = restorePlan.data as BackupRestorePlan | undefined;

  async function refreshWorkflow() {
    await Promise.all([workflow.refetch(), restorePlan.refetch()]);
  }

  async function runBackup(policyId: string, policyName: string) {
    feedback.clear();
    try {
      await triggerBackup.mutateAsync({ policyId });
      await workflow.refetch();
      feedback.setSuccess(`Queued backup for ${policyName}.`);
    } catch (error) {
      feedback.setError(error, "Unable to queue this backup right now.");
    }
  }

  async function queuePreviewedRestore() {
    if (!previewRunId) return;

    feedback.clear();
    try {
      await queueRestore.mutateAsync({ backupRunId: previewRunId });
      await refreshWorkflow();
      feedback.setSuccess(`Queued restore for ${serviceName}.`);
    } catch (error) {
      feedback.setError(error, "Unable to queue this restore right now.");
    }
  }

  if (workflow.isLoading) {
    return (
      <div className="space-y-4" data-testid="service-backups-loading">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (workflow.error) {
    return (
      <Alert variant="destructive" data-testid="service-backups-error">
        <AlertTitle>Backup workflow unavailable</AlertTitle>
        <AlertDescription>{workflow.error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.volumes.length === 0) {
    return (
      <Card data-testid="service-backups-empty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive size={16} />
            Volume backups
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No registered volumes are linked to {serviceName}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const selectedRun = data.runs.find((run) => run.id === previewRunId);

  return (
    <section className="space-y-6" data-testid="service-backups-tab">
      <BackupSummaryGrid data={data} />

      {feedback.message ? (
        <p
          className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
          data-testid="service-backups-feedback"
        >
          {feedback.message}
        </p>
      ) : null}

      <BackupVolumesTable data={data} />
      <BackupPoliciesAndRuns
        data={data}
        runPending={triggerBackup.isPending}
        onRunBackup={(policyId, policyName) => void runBackup(policyId, policyName)}
        onPreviewRestore={setPreviewRunId}
      />

      {previewRunId ? (
        <BackupRestorePreview
          plan={plan}
          planError={restorePlan.error}
          isLoading={restorePlan.isLoading}
          isPending={queueRestore.isPending}
          previewRunId={previewRunId}
          selectedRun={selectedRun}
          onQueueRestore={() => void queuePreviewedRestore()}
        />
      ) : null}

      <BackupRestoreHistory restores={data.restores} />
    </section>
  );
}
