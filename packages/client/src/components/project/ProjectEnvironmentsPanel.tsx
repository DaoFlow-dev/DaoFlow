import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";

const INHERIT_SERVER_VALUE = "__inherit_server__";
const ACTIVE_STATUS_VALUE = "active";

interface EnvironmentRecord {
  id: string;
  name: string;
  status: string;
  statusTone?: string;
  targetServerId?: string | null;
  composeFiles?: string[];
  composeProfiles?: string[];
  serviceCount?: number;
}

interface ServerRecord {
  id: string;
  name: string;
  host?: string | null;
}

interface EnvironmentDraft {
  id?: string;
  name: string;
  status: string;
  targetServerId: string;
  composeFiles: string;
  composeProfiles: string;
}

interface ProjectEnvironmentsPanelProps {
  projectId: string;
  environments: EnvironmentRecord[];
  servers: ServerRecord[];
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  errorMessage?: string | null;
  onCreate: (input: {
    projectId: string;
    name: string;
    targetServerId?: string;
    composeFiles?: string[];
    composeProfiles?: string[];
  }) => void;
  onUpdate: (input: {
    environmentId: string;
    name?: string;
    status?: string;
    targetServerId?: string;
    composeFiles?: string[];
    composeProfiles?: string[];
  }) => void;
  onDelete: (environmentId: string) => void;
}

function toCommaSeparated(values?: string[]) {
  return (values ?? []).join(", ");
}

function parseCommaSeparated(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function makeDraft(environment?: EnvironmentRecord): EnvironmentDraft {
  return {
    id: environment?.id,
    name: environment?.name ?? "",
    status: environment?.status ?? ACTIVE_STATUS_VALUE,
    targetServerId: environment?.targetServerId ?? INHERIT_SERVER_VALUE,
    composeFiles: toCommaSeparated(environment?.composeFiles),
    composeProfiles: toCommaSeparated(environment?.composeProfiles)
  };
}

export function ProjectEnvironmentsPanel({
  projectId,
  environments,
  servers,
  createPending,
  updatePending,
  deletePending,
  errorMessage,
  onCreate,
  onUpdate,
  onDelete
}: ProjectEnvironmentsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EnvironmentRecord | null>(null);
  const [draft, setDraft] = useState<EnvironmentDraft>(makeDraft());
  const previousSubmitPending = useRef(false);
  const previousDeletePending = useRef(false);

  const submitPending = createPending || updatePending;
  const serverLabelById = useMemo(
    () =>
      new Map(
        servers.map((server) => [
          server.id,
          `${server.name}${server.host ? ` · ${server.host}` : ""}`
        ])
      ),
    [servers]
  );

  function openCreateDialog() {
    setDraft(makeDraft());
    setDialogOpen(true);
  }

  function openEditDialog(environment: EnvironmentRecord) {
    setDraft(makeDraft(environment));
    setDialogOpen(true);
  }

  function submitEnvironment() {
    const name = draft.name.trim();
    if (!name) {
      return;
    }

    const payload = {
      targetServerId:
        draft.targetServerId === INHERIT_SERVER_VALUE ? "" : draft.targetServerId.trim(),
      composeFiles: parseCommaSeparated(draft.composeFiles),
      composeProfiles: parseCommaSeparated(draft.composeProfiles)
    };

    if (draft.id) {
      onUpdate({
        environmentId: draft.id,
        name,
        status: draft.status,
        targetServerId: payload.targetServerId,
        composeFiles: payload.composeFiles,
        composeProfiles: payload.composeProfiles
      });
      return;
    }

    onCreate({
      projectId,
      name,
      targetServerId: payload.targetServerId || undefined,
      composeFiles: payload.composeFiles,
      composeProfiles: payload.composeProfiles
    });
  }

  useEffect(() => {
    if (previousSubmitPending.current && !submitPending && !errorMessage) {
      setDialogOpen(false);
      setDraft(makeDraft());
    }

    previousSubmitPending.current = submitPending;
  }, [errorMessage, submitPending]);

  useEffect(() => {
    if (previousDeletePending.current && !deletePending && !errorMessage) {
      setDeleteTarget(null);
    }

    previousDeletePending.current = deletePending;
  }, [deletePending, errorMessage]);

  return (
    <section className="space-y-4" data-testid="project-environments-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">Environments</h2>
          <p className="text-sm text-muted-foreground">
            Manage per-environment server and Compose overrides on top of the project defaults.
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="project-environments-create-trigger">
          <Plus size={14} className="mr-1" />
          Add Environment
        </Button>
      </div>

      {environments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            No environments yet. Create production, staging, or preview lanes here before adding
            services.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {environments.map((environment) => (
            <Card key={environment.id} className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers size={15} />
                      {environment.name}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{environment.id}</p>
                  </div>
                  <Badge
                    variant={getInventoryBadgeVariant(environment.statusTone ?? environment.status)}
                  >
                    {environment.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-2 text-muted-foreground">
                  <p>
                    Server:{" "}
                    <span className="text-foreground">
                      {environment.targetServerId
                        ? (serverLabelById.get(environment.targetServerId) ??
                          environment.targetServerId)
                        : "Project default"}
                    </span>
                  </p>
                  <p>
                    Services:{" "}
                    <span className="text-foreground">{environment.serviceCount ?? 0}</span>
                  </p>
                  <p>
                    Compose files:{" "}
                    <span className="text-foreground">
                      {environment.composeFiles?.length
                        ? environment.composeFiles.join(", ")
                        : "Project default"}
                    </span>
                  </p>
                  <p>
                    Compose profiles:{" "}
                    <span className="text-foreground">
                      {environment.composeProfiles?.length
                        ? environment.composeProfiles.join(", ")
                        : "Project default"}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditDialog(environment)}
                    data-testid={`project-environment-edit-${environment.id}`}
                  >
                    <Pencil size={14} className="mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteTarget(environment)}
                    data-testid={`project-environment-delete-${environment.id}`}
                  >
                    <Trash2 size={14} className="mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit Environment" : "Create Environment"}</DialogTitle>
            <DialogDescription>
              Override target server or Compose settings for one environment without rewriting the
              project-level defaults.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitEnvironment();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="environment-name">Environment Name</Label>
              <Input
                id="environment-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="production"
                required
                data-testid="project-environment-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-status">Status</Label>
              <Select
                value={draft.status}
                onValueChange={(value) => setDraft((current) => ({ ...current, status: value }))}
              >
                <SelectTrigger id="environment-status" data-testid="project-environment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="paused">paused</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-server">Target Server</Label>
              <Select
                value={draft.targetServerId}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, targetServerId: value }))
                }
              >
                <SelectTrigger id="environment-server" data-testid="project-environment-server">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_SERVER_VALUE}>Project default</SelectItem>
                  {servers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name}
                      {server.host ? ` · ${server.host}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-compose-files">Compose Files</Label>
              <Input
                id="environment-compose-files"
                value={draft.composeFiles}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, composeFiles: event.target.value }))
                }
                placeholder="compose.yaml, compose.prod.yaml"
                data-testid="project-environment-compose-files"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="environment-compose-profiles">Compose Profiles</Label>
              <Input
                id="environment-compose-profiles"
                value={draft.composeProfiles}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, composeProfiles: event.target.value }))
                }
                placeholder="web, workers"
                data-testid="project-environment-compose-profiles"
              />
            </div>
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitPending || !draft.name.trim()}>
                {submitPending ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Saving...
                  </>
                ) : draft.id ? (
                  "Save Environment"
                ) : (
                  "Create Environment"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete environment "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the environment and any services attached to it. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget || deletePending) {
                  return;
                }
                onDelete(deleteTarget.id);
              }}
              disabled={deletePending}
              data-testid={
                deleteTarget ? `project-environment-delete-confirm-${deleteTarget.id}` : undefined
              }
            >
              {deletePending ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Environment"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
