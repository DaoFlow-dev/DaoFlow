import { useEffect, useMemo, useRef, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { HardDrive, Pencil, Plus, Trash2 } from "lucide-react";
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
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { VolumeRegistryDialog } from "./VolumeRegistryDialog";
import { UNLINKED_SERVICE, makeDraft, type VolumeDraft } from "./volume-registry-types";

export function VolumeRegistryPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const persistentVolumes = trpc.persistentVolumes.useQuery({});
  const serverReadiness = trpc.serverReadiness.useQuery({});
  const services = trpc.services.useQuery({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; volumeName: string } | null>(null);
  const [draft, setDraft] = useState<VolumeDraft>(makeDraft());
  const [feedback, setFeedback] = useState<string | null>(null);
  const previousSubmitPending = useRef(false);
  const previousDeletePending = useRef(false);

  const refreshViews = async () => {
    await Promise.all([
      utils.persistentVolumes.invalidate(),
      utils.backupOverview.invalidate(),
      utils.serverReadiness.invalidate()
    ]);
  };

  const createVolume = trpc.createVolume.useMutation({
    onSuccess: async (volume) => {
      if (!volume) {
        setFeedback("Registered the volume.");
        await refreshViews();
        return;
      }
      await refreshViews();
      setFeedback(`Registered volume ${volume.name}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to register the volume.")
  });
  const updateVolume = trpc.updateVolume.useMutation({
    onSuccess: async (volume) => {
      if (!volume) {
        setFeedback("Updated the volume.");
        await refreshViews();
        return;
      }
      await refreshViews();
      setFeedback(`Updated volume ${volume.name}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to update the volume.")
  });
  const deleteVolume = trpc.deleteVolume.useMutation({
    onSuccess: async () => {
      await refreshViews();
      setFeedback("Deleted the volume registry entry.");
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to delete the volume.")
  });

  const submitPending = createVolume.isPending || updateVolume.isPending;
  const deletePending = deleteVolume.isPending;

  useEffect(() => {
    if (
      previousSubmitPending.current &&
      !submitPending &&
      !createVolume.error &&
      !updateVolume.error
    ) {
      setDialogOpen(false);
      setDraft(makeDraft());
    }
    previousSubmitPending.current = submitPending;
  }, [createVolume.error, submitPending, updateVolume.error]);

  useEffect(() => {
    if (previousDeletePending.current && !deletePending && !deleteVolume.error) {
      setDeleteTarget(null);
    }
    previousDeletePending.current = deletePending;
  }, [deletePending, deleteVolume.error]);

  const volumes = persistentVolumes.data?.volumes ?? [];

  const serverOptions = useMemo(
    () =>
      (serverReadiness.data?.checks ?? []).map((server) => ({
        id: String(server.serverId),
        label: `${String(server.serverName)} · ${String(server.serverHost)}`
      })),
    [serverReadiness.data?.checks]
  );

  const serviceOptions = useMemo(
    () =>
      (services.data ?? []).map((service) => ({
        id: String(service.id),
        label: `${String(service.projectName ?? "Project")} / ${String(service.environmentName ?? "Env")} / ${String(service.name)}`
      })),
    [services.data]
  );

  const serverLabelById = useMemo(
    () => new Map(serverOptions.map((server) => [server.id, server.label])),
    [serverOptions]
  );
  const serviceLabelById = useMemo(
    () => new Map(serviceOptions.map((service) => [service.id, service.label])),
    [serviceOptions]
  );

  function openCreateDialog() {
    setDraft(makeDraft());
    setDialogOpen(true);
  }

  function openEditDialog(volume: (typeof volumes)[number]) {
    setDraft(
      makeDraft({
        id: volume.id,
        volumeName: volume.volumeName,
        serverId: volume.serverId,
        mountPath: volume.mountPath,
        serviceId: volume.serviceId,
        driver: volume.driver,
        sizeBytes: volume.sizeBytes,
        status: volume.status
      })
    );
    setDialogOpen(true);
  }

  function submitVolume() {
    const payload = {
      name: draft.name.trim(),
      serverId: draft.serverId.trim(),
      mountPath: draft.mountPath.trim(),
      serviceId: draft.serviceId === UNLINKED_SERVICE ? "" : draft.serviceId.trim(),
      driver: draft.driver.trim() || "local",
      sizeBytes: draft.sizeBytes ? Number(draft.sizeBytes) : undefined,
      status: draft.status
    };

    if (!payload.name || !payload.serverId || !payload.mountPath) {
      setFeedback("Name, server, and mount path are required.");
      return;
    }

    if (draft.id) {
      updateVolume.mutate({
        volumeId: draft.id,
        ...payload
      });
      return;
    }

    createVolume.mutate(payload);
  }

  return (
    <div className="space-y-4" data-testid="settings-volume-registry">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold" data-testid="volume-registry-title">
            Persistent volume registry
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="volume-registry-description">
            Track server-mounted data, link it to services, and attach backup coverage.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreateDialog} data-testid="volume-create-trigger">
            <Plus size={14} className="mr-1" />
            Register Volume
          </Button>
        ) : null}
      </div>

      {feedback ? (
        <p className="text-sm text-muted-foreground" data-testid="volume-registry-feedback">
          {feedback}
        </p>
      ) : null}

      {persistentVolumes.isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground" data-testid="volume-loading">
            Loading volume registry…
          </CardContent>
        </Card>
      ) : volumes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/5">
              <HardDrive size={24} className="text-primary/50" />
            </div>
            <p className="mt-3 text-sm" data-testid="volume-empty-state">
              No volumes are registered yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="volume-summary-grid"
          >
            <SummaryCard
              label="Volumes"
              value={persistentVolumes.data?.summary.totalVolumes ?? 0}
            />
            <SummaryCard
              label="Protected"
              value={persistentVolumes.data?.summary.protectedVolumes ?? 0}
            />
            <SummaryCard
              label="Attention"
              value={persistentVolumes.data?.summary.attentionVolumes ?? 0}
            />
            <SummaryCard
              label="Attached Bytes"
              value={persistentVolumes.data?.summary.attachedBytes ?? 0}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {volumes.map((volume) => (
              <Card key={volume.id} className="border-border/60 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base" data-testid={`volume-title-${volume.id}`}>
                        {volume.volumeName}
                      </CardTitle>
                      <CardDescription data-testid={`volume-server-${volume.id}`}>
                        {volume.targetServerName} · {volume.mountPath}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={getBadgeVariantFromTone(volume.statusTone)}
                      data-testid={`volume-coverage-${volume.id}`}
                    >
                      {volume.backupCoverage}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground" data-testid={`volume-service-${volume.id}`}>
                    {volume.serviceName
                      ? `${volume.projectName} / ${volume.environmentName} / ${volume.serviceName}`
                      : "No linked service"}
                  </p>
                  <p className="text-muted-foreground" data-testid={`volume-driver-${volume.id}`}>
                    Driver {volume.driver} · Status {volume.status} · Backup policy{" "}
                    {volume.backupPolicyId ?? "unmanaged"}
                  </p>
                  {canManage ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditDialog(volume)}
                        data-testid={`volume-edit-${volume.id}`}
                      >
                        <Pencil size={14} className="mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDeleteTarget({ id: volume.id, volumeName: volume.volumeName })
                        }
                        data-testid={`volume-delete-${volume.id}`}
                      >
                        <Trash2 size={14} className="mr-1" />
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <VolumeRegistryDialog
        dialogOpen={dialogOpen}
        draft={draft}
        serverLabelById={serverLabelById}
        serverOptions={serverOptions}
        serviceLabelById={serviceLabelById}
        serviceOptions={serviceOptions}
        setDialogOpen={setDialogOpen}
        setDraft={setDraft}
        submitPending={submitPending}
        submitVolume={submitVolume}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete volume entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the registry entry for {deleteTarget?.volumeName}. Existing backup
              policies must be removed first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="volume-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteVolume.mutate({ volumeId: deleteTarget.id })}
              data-testid="volume-delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className="mt-1 text-2xl font-bold"
          data-testid={`volume-summary-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
