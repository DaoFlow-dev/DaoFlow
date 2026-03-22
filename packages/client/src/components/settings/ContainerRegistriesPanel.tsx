import { useEffect, useRef, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

interface RegistryDraft {
  id?: string;
  name: string;
  registryHost: string;
  username: string;
  password: string;
}

function makeDraft(input?: Partial<RegistryDraft>): RegistryDraft {
  return {
    id: input?.id,
    name: input?.name ?? "",
    registryHost: input?.registryHost ?? "",
    username: input?.username ?? "",
    password: ""
  };
}

export function ContainerRegistriesPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const registries = trpc.containerRegistries.useQuery(undefined, {
    enabled: canManage
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [draft, setDraft] = useState<RegistryDraft>(makeDraft());
  const [feedback, setFeedback] = useState<string | null>(null);
  const previousSubmitPending = useRef(false);
  const previousDeletePending = useRef(false);

  const refreshRegistries = async () => {
    await utils.containerRegistries.invalidate();
  };

  const createRegistry = trpc.registerContainerRegistry.useMutation({
    onSuccess: async (registry) => {
      await refreshRegistries();
      setFeedback(`Saved credentials for ${registry.registryHost}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to save the registry.")
  });

  const updateRegistry = trpc.updateContainerRegistry.useMutation({
    onSuccess: async (registry) => {
      await refreshRegistries();
      setFeedback(`Updated credentials for ${registry.registryHost}.`);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to update the registry.")
  });

  const deleteRegistry = trpc.deleteContainerRegistry.useMutation({
    onSuccess: async () => {
      await refreshRegistries();
      setFeedback("Deleted the registry credentials.");
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to delete the registry.")
  });

  const submitPending = createRegistry.isPending || updateRegistry.isPending;
  const deletePending = deleteRegistry.isPending;

  useEffect(() => {
    if (
      previousSubmitPending.current &&
      !submitPending &&
      !createRegistry.error &&
      !updateRegistry.error
    ) {
      setDialogOpen(false);
      setDraft(makeDraft());
    }
    previousSubmitPending.current = submitPending;
  }, [createRegistry.error, submitPending, updateRegistry.error]);

  useEffect(() => {
    if (previousDeletePending.current && !deletePending && !deleteRegistry.error) {
      setDeleteTarget(null);
    }
    previousDeletePending.current = deletePending;
  }, [deletePending, deleteRegistry.error]);

  const registryItems = registries.data ?? [];

  function openCreateDialog() {
    setDraft(makeDraft());
    setDialogOpen(true);
  }

  function openEditDialog(registry: (typeof registryItems)[number]) {
    setDraft(
      makeDraft({
        id: registry.id,
        name: registry.name,
        registryHost: registry.registryHost,
        username: registry.username
      })
    );
    setDialogOpen(true);
  }

  function submitRegistry() {
    const payload = {
      name: draft.name.trim(),
      registryHost: draft.registryHost.trim(),
      username: draft.username.trim(),
      password: draft.password.trim()
    };

    if (!payload.name || !payload.registryHost || !payload.username) {
      setFeedback("Name, registry host, and username are required.");
      return;
    }

    if (!draft.id && !payload.password) {
      setFeedback("A password or access token is required.");
      return;
    }

    if (draft.id) {
      updateRegistry.mutate({
        registryId: draft.id,
        ...payload,
        password: payload.password || undefined
      });
      return;
    }

    createRegistry.mutate({
      ...payload,
      password: payload.password
    });
  }

  return (
    <div className="space-y-4" data-testid="settings-container-registries">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold" data-testid="container-registries-title">
            Container registries
          </h2>
          <p
            className="text-sm text-muted-foreground"
            data-testid="container-registries-description"
          >
            Store credentials for private GHCR, Docker Hub, and other Docker-compatible registries.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreateDialog} data-testid="container-registry-create-trigger">
            <Plus size={14} className="mr-1" />
            Add Registry
          </Button>
        ) : null}
      </div>

      {feedback ? (
        <p className="text-sm text-muted-foreground" data-testid="container-registries-feedback">
          {feedback}
        </p>
      ) : null}

      {registries.isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Loading registry credentials…
          </CardContent>
        </Card>
      ) : registryItems.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/5">
              <Boxes size={24} className="text-primary/50" />
            </div>
            <p className="mt-3 text-sm" data-testid="container-registries-empty-state">
              No private registries are configured yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {registryItems.map((registry) => (
            <Card key={registry.id} className="border-border/60 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle
                      className="text-base"
                      data-testid={`container-registry-title-${registry.id}`}
                    >
                      {registry.name}
                    </CardTitle>
                    <CardDescription data-testid={`container-registry-host-${registry.id}`}>
                      {registry.registryHost}
                    </CardDescription>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditDialog(registry)}
                        data-testid={`container-registry-edit-${registry.id}`}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setDeleteTarget({ id: registry.id, name: registry.name })}
                        data-testid={`container-registry-delete-${registry.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>Username: {registry.username}</p>
                <p>Saved: {new Date(registry.updatedAt).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit Registry" : "Add Registry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="registry-name">Name</Label>
              <Input
                id="registry-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="GitHub Container Registry"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-host">Registry host</Label>
              <Input
                id="registry-host"
                value={draft.registryHost}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, registryHost: event.target.value }))
                }
                placeholder="ghcr.io or docker.io"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-username">Username</Label>
              <Input
                id="registry-username"
                value={draft.username}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="octocat"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-password">
                {draft.id ? "Password or access token" : "Password or access token"}
              </Label>
              <Input
                id="registry-password"
                type="password"
                value={draft.password}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, password: event.target.value }))
                }
                placeholder={draft.id ? "Leave blank to keep the current secret" : "Paste a PAT"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRegistry} disabled={submitPending}>
              {draft.id ? "Save Changes" : "Save Registry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Registry</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the saved credentials for {deleteTarget?.name}. Existing images already pulled
              onto servers will keep working, but future private pulls may fail until you add valid
              credentials again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletePending}
              onClick={() =>
                deleteTarget ? deleteRegistry.mutate({ registryId: deleteTarget.id }) : undefined
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
