import { useEffect, useMemo, useRef, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Clock, Pencil, PlayCircle, Plus, StopCircle, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { BackupPolicyDialog } from "./BackupPolicyDialog";
import {
  NO_DESTINATION,
  makeDraft,
  type DatabaseEngine,
  type PolicyDraft
} from "./backup-policy-manager-types";

export function BackupPolicyManager() {
  const utils = trpc.useUtils();
  const backupOverview = trpc.backupOverview.useQuery({});
  const persistentVolumes = trpc.persistentVolumes.useQuery({});
  const backupDestinations = trpc.backupDestinations.useQuery({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(makeDraft());
  const [feedback, setFeedback] = useState<string | null>(null);
  const previousSubmitPending = useRef(false);
  const previousDeletePending = useRef(false);

  const refreshViews = async () => {
    await Promise.all([utils.backupOverview.invalidate(), utils.persistentVolumes.invalidate()]);
  };

  const createPolicy = trpc.createBackupPolicy.useMutation({
    onSuccess: async (policy) => {
      if (!policy) {
        setFeedback("Created the backup policy.");
        await refreshViews();
        return;
      }
      await refreshViews();
      setFeedback(`Created backup policy ${policy.name}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to create the backup policy.")
  });
  const updatePolicy = trpc.updateBackupPolicy.useMutation({
    onSuccess: async (policy) => {
      if (!policy) {
        setFeedback("Updated the backup policy.");
        await refreshViews();
        return;
      }
      await refreshViews();
      setFeedback(`Updated backup policy ${policy.name}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to update the backup policy.")
  });
  const deletePolicy = trpc.deleteBackupPolicy.useMutation({
    onSuccess: async () => {
      await refreshViews();
      setFeedback("Deleted the backup policy.");
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to delete the backup policy.")
  });
  const disableSchedule = trpc.disableBackupSchedule.useMutation({
    onSuccess: async () => {
      await refreshViews();
      setFeedback("Disabled the backup schedule.");
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to disable the schedule.")
  });
  const triggerNow = trpc.triggerBackupNow.useMutation({
    onSuccess: async () => {
      await refreshViews();
      setFeedback("Queued the backup run.");
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to queue the backup run.")
  });

  const submitPending = createPolicy.isPending || updatePolicy.isPending;
  const deletePending = deletePolicy.isPending;

  useEffect(() => {
    if (
      previousSubmitPending.current &&
      !submitPending &&
      !createPolicy.error &&
      !updatePolicy.error
    ) {
      setDialogOpen(false);
      setDraft(makeDraft());
    }
    previousSubmitPending.current = submitPending;
  }, [createPolicy.error, submitPending, updatePolicy.error]);

  useEffect(() => {
    if (previousDeletePending.current && !deletePending && !deletePolicy.error) {
      setDeleteTarget(null);
    }
    previousDeletePending.current = deletePending;
  }, [deletePending, deletePolicy.error]);

  const policies = backupOverview.data?.policies ?? [];

  const volumeLabelById = useMemo(
    () =>
      new Map(
        (persistentVolumes.data?.volumes ?? []).map((volume) => [
          volume.id,
          `${volume.projectName || "Project"} / ${volume.environmentName || "Env"} / ${volume.volumeName}`
        ])
      ),
    [persistentVolumes.data?.volumes]
  );
  const destinationLabelById = useMemo(
    () =>
      new Map(
        (backupDestinations.data ?? []).map((destination) => [destination.id, destination.name])
      ),
    [backupDestinations.data]
  );

  function openCreateDialog() {
    setDraft(makeDraft());
    setDialogOpen(true);
  }

  function openEditDialog(policy: (typeof policies)[number]) {
    setDraft(
      makeDraft({
        id: policy.id,
        name: policy.name,
        volumeId: policy.volumeId,
        destinationId: policy.destinationId,
        backupType: policy.backupType as PolicyDraft["backupType"],
        databaseEngine: policy.databaseEngine ?? "",
        turnOff: policy.turnOff,
        schedule: policy.schedule,
        retentionDays: policy.retentionDays,
        status: policy.status as PolicyDraft["status"]
      })
    );
    setDialogOpen(true);
  }

  function submitPolicy() {
    const retentionDays = Number(draft.retentionDays);
    if (
      !draft.name.trim() ||
      !draft.volumeId.trim() ||
      !Number.isFinite(retentionDays) ||
      retentionDays < 1
    ) {
      setFeedback("Policy name, volume, and a positive retention window are required.");
      return;
    }

    const payload = {
      name: draft.name.trim(),
      volumeId: draft.volumeId.trim(),
      destinationId: draft.destinationId === NO_DESTINATION ? "" : draft.destinationId.trim(),
      backupType: draft.backupType,
      databaseEngine: (draft.databaseEngine.trim() || undefined) as DatabaseEngine | undefined,
      turnOff: draft.turnOff,
      schedule: draft.schedule.trim(),
      retentionDays,
      status: draft.status
    };

    if (draft.id) {
      updatePolicy.mutate({
        policyId: draft.id,
        ...payload
      });
      return;
    }

    createPolicy.mutate(payload);
  }

  return (
    <Card className="shadow-sm" data-testid="backup-policy-manager">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-semibold">Backup Policies</CardTitle>
            <CardDescription data-testid="backup-policy-description">
              Create policy ownership for registered volumes and keep schedules editable.
            </CardDescription>
          </div>
          <Button
            onClick={openCreateDialog}
            disabled={(persistentVolumes.data?.volumes ?? []).length === 0}
            data-testid="backup-policy-create-trigger"
          >
            <Plus size={14} className="mr-1" />
            New Policy
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedback ? (
          <p className="text-sm text-muted-foreground" data-testid="backup-policy-feedback">
            {feedback}
          </p>
        ) : null}

        {backupOverview.isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="backup-policy-loading">
            Loading backup policies…
          </p>
        ) : policies.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {(persistentVolumes.data?.volumes ?? []).length === 0
              ? "Register a volume in Settings before creating the first backup policy."
              : "No backup policies yet. Create one to connect a registered volume to a destination and schedule."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {policies.map((policy) => {
              const hasSchedule = Boolean(policy.scheduleLabel);
              return (
                <div
                  key={policy.id}
                  className="rounded-xl border border-border/50 p-5 shadow-sm"
                  data-testid={`backup-policy-card-${policy.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p
                        className="text-sm font-semibold"
                        data-testid={`backup-policy-name-${policy.id}`}
                      >
                        {policy.name}
                      </p>
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid={`backup-policy-target-${policy.id}`}
                      >
                        {policy.projectName}/{policy.environmentName}/{policy.serviceName}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {hasSchedule ? (
                        <Badge
                          variant="default"
                          data-testid={`backup-policy-schedule-${policy.id}`}
                        >
                          <Clock size={10} className="mr-1" />
                          {String(policy.scheduleLabel)}
                        </Badge>
                      ) : null}
                      <Badge variant="secondary">{String(policy.targetType)}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Destination {policy.storageProvider} · Retention {policy.retentionDays} days
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last run {policy.lastRunAt ? new Date(policy.lastRunAt).toLocaleString() : "—"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditDialog(policy)}
                      data-testid={`backup-policy-edit-${policy.id}`}
                    >
                      <Pencil size={14} className="mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteTarget({ id: policy.id, name: policy.name })}
                      data-testid={`backup-policy-delete-${policy.id}`}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Delete
                    </Button>
                    {hasSchedule ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => disableSchedule.mutate({ policyId: policy.id })}
                        data-testid={`backup-policy-disable-${policy.id}`}
                      >
                        <StopCircle size={14} className="mr-1" />
                        Disable
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => triggerNow.mutate({ policyId: policy.id })}
                      data-testid={`backup-policy-run-${policy.id}`}
                    >
                      <PlayCircle size={14} className="mr-1" />
                      Run Now
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <BackupPolicyDialog
        destinationLabelById={destinationLabelById}
        destinationOptions={backupDestinations.data ?? []}
        dialogOpen={dialogOpen}
        draft={draft}
        setDialogOpen={setDialogOpen}
        setDraft={setDraft}
        submitPending={submitPending}
        submitPolicy={submitPolicy}
        volumeLabelById={volumeLabelById}
        volumeOptions={persistentVolumes.data?.volumes ?? []}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backup policy?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deleteTarget?.name}. Existing run history must be cleared first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="backup-policy-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deletePolicy.mutate({ policyId: deleteTarget.id })}
              data-testid="backup-policy-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
