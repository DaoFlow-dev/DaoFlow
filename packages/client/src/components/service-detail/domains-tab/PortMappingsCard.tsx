import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Cable, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { PortMappingDraft, ServicePortProtocol } from "./types";

interface PortMappingsCardProps {
  serviceId: string;
  serviceName: string;
  portDrafts: PortMappingDraft[];
  newHostPort: string;
  newContainerPort: string;
  newProtocol: ServicePortProtocol;
  portFeedback: string | null;
  portsDirty: boolean;
  isSaving: boolean;
  onNewHostPortChange: (value: string) => void;
  onNewContainerPortChange: (value: string) => void;
  onToggleNewProtocol: () => void;
  onAddPortDraft: () => void;
  onUpdateDraft: (
    draftId: string,
    patch: Partial<Pick<PortMappingDraft, "hostPort" | "containerPort" | "protocol">>
  ) => void;
  onRemoveDraft: (draftId: string) => void;
  onResetPorts: () => void;
  onSavePorts: () => void;
}

export function PortMappingsCard({
  serviceId,
  serviceName,
  portDrafts,
  newHostPort,
  newContainerPort,
  newProtocol,
  portFeedback,
  portsDirty,
  isSaving,
  onNewHostPortChange,
  onNewContainerPortChange,
  onToggleNewProtocol,
  onAddPortDraft,
  onUpdateDraft,
  onRemoveDraft,
  onResetPorts,
  onSavePorts
}: PortMappingsCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Cable size={14} />
          Port Mappings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Persist explicit published ports for {serviceName}. Adjust rows inline, then save the
          desired published-port state.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            type="number"
            placeholder="Host port"
            value={newHostPort}
            onChange={(event) => onNewHostPortChange(event.target.value)}
            className="h-8 w-28 text-sm"
            data-testid={`service-port-host-input-${serviceId}`}
          />
          <span className="text-muted-foreground">:</span>
          <Input
            type="number"
            placeholder="Container port"
            value={newContainerPort}
            onChange={(event) => onNewContainerPortChange(event.target.value)}
            className="h-8 w-32 text-sm"
            data-testid={`service-port-container-input-${serviceId}`}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={onToggleNewProtocol}
            data-testid={`service-port-protocol-toggle-${serviceId}`}
          >
            {newProtocol.toUpperCase()}
          </Button>
          <Button
            size="sm"
            onClick={onAddPortDraft}
            disabled={!newHostPort.trim() || !newContainerPort.trim()}
            data-testid={`service-port-add-${serviceId}`}
          >
            <Plus size={14} className="mr-1" />
            Add
          </Button>
        </div>

        {portDrafts.length === 0 ? (
          <p
            className="text-sm text-muted-foreground py-4 text-center"
            data-testid={`service-port-empty-${serviceId}`}
          >
            No explicit DaoFlow-managed port mappings are saved.
          </p>
        ) : (
          <div className="space-y-2">
            {portDrafts.map((draft) => (
              <PortMappingRow
                key={draft.draftId}
                draft={draft}
                serviceId={serviceId}
                onUpdateDraft={onUpdateDraft}
                onRemoveDraft={onRemoveDraft}
              />
            ))}
          </div>
        )}

        {portFeedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-port-feedback-${serviceId}`}
          >
            {portFeedback}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onResetPorts}
            disabled={!portsDirty || isSaving}
            data-testid={`service-port-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={onSavePorts}
            disabled={!portsDirty || isSaving}
            data-testid={`service-port-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {isSaving ? "Saving..." : "Save Mappings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PortMappingRow({
  draft,
  serviceId,
  onUpdateDraft,
  onRemoveDraft
}: {
  draft: PortMappingDraft;
  serviceId: string;
  onUpdateDraft: (
    draftId: string,
    patch: Partial<Pick<PortMappingDraft, "hostPort" | "containerPort" | "protocol">>
  ) => void;
  onRemoveDraft: (draftId: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3 py-3 lg:flex-row lg:items-center lg:justify-between"
      data-testid={`service-port-row-${serviceId}-${draft.draftId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          value={draft.hostPort}
          onChange={(event) => onUpdateDraft(draft.draftId, { hostPort: event.target.value })}
          className="h-8 w-28 text-sm font-mono"
          data-testid={`service-port-row-host-${serviceId}-${draft.draftId}`}
        />
        <span className="text-muted-foreground">→</span>
        <Input
          type="number"
          value={draft.containerPort}
          onChange={(event) => onUpdateDraft(draft.draftId, { containerPort: event.target.value })}
          className="h-8 w-32 text-sm font-mono"
          data-testid={`service-port-row-container-${serviceId}-${draft.draftId}`}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            onUpdateDraft(draft.draftId, {
              protocol: draft.protocol === "tcp" ? "udp" : "tcp"
            })
          }
          data-testid={`service-port-row-protocol-${serviceId}-${draft.draftId}`}
        >
          {draft.protocol.toUpperCase()}
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => onRemoveDraft(draft.draftId)}
        aria-label={`Remove port mapping ${draft.hostPort} to ${draft.containerPort}`}
        data-testid={`service-port-remove-${serviceId}-${draft.draftId}`}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
