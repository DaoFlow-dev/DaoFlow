import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { EnvironmentCards } from "./project-environments-panel/EnvironmentCards";
import { EnvironmentDeleteDialog } from "./project-environments-panel/EnvironmentDeleteDialog";
import { EnvironmentEditorDialog } from "./project-environments-panel/EnvironmentEditorDialog";
import type {
  EnvironmentDraft,
  EnvironmentRecord,
  ProjectEnvironmentsPanelProps
} from "./project-environments-panel/types";
import {
  INHERIT_SERVER_VALUE,
  makeDraft,
  parseCommaSeparated
} from "./project-environments-panel/utils";

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

  function handleDraftChange(field: keyof EnvironmentDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
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

      <EnvironmentCards
        environments={environments}
        serverLabelById={serverLabelById}
        onEdit={openEditDialog}
        onDelete={setDeleteTarget}
      />

      <EnvironmentEditorDialog
        open={dialogOpen}
        draft={draft}
        servers={servers}
        submitPending={submitPending}
        errorMessage={errorMessage}
        onOpenChange={setDialogOpen}
        onDraftChange={handleDraftChange}
        onSubmit={submitEnvironment}
      />

      <EnvironmentDeleteDialog
        deletePending={deletePending}
        target={deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (!deleteTarget || deletePending) {
            return;
          }
          onDelete(deleteTarget.id);
        }}
      />
    </section>
  );
}
