import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { HardDrive, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { ServiceRuntimeVolume, RuntimeVolumeMode } from "./runtime-config";

interface VolumesCardProps {
  serviceId: string;
  volumes: ServiceRuntimeVolume[];
  onSaved: () => Promise<unknown>;
}

interface VolumeDraft extends ServiceRuntimeVolume {
  id: string;
}

function toDraft(volumes: ServiceRuntimeVolume[]): VolumeDraft[] {
  return volumes.map((volume, index) => ({
    id: `${volume.target}-${index}`,
    ...volume
  }));
}

export function VolumesCard({ serviceId, volumes, onSaved }: VolumesCardProps) {
  const [drafts, setDrafts] = useState<VolumeDraft[]>(toDraft(volumes));
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();

  useEffect(() => {
    setDrafts(toDraft(volumes));
  }, [volumes]);

  const baseline = JSON.stringify(volumes);
  const current = JSON.stringify(drafts.map(({ id: _id, ...volume }) => volume));
  const isDirty = baseline !== current;

  function addVolume() {
    if (!newSource.trim() || !newTarget.trim()) {
      return;
    }

    setDrafts((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        source: newSource.trim(),
        target: newTarget.trim(),
        mode: "rw"
      }
    ]);
    setNewSource("");
    setNewTarget("");
  }

  function removeVolume(id: string) {
    setDrafts((previous) => previous.filter((volume) => volume.id !== id));
  }

  function toggleMode(id: string) {
    setDrafts((previous) =>
      previous.map((volume) =>
        volume.id === id
          ? {
              ...volume,
              mode: volume.mode === "rw" ? ("ro" as RuntimeVolumeMode) : ("rw" as RuntimeVolumeMode)
            }
          : volume
      )
    );
  }

  async function handleSave() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        volumes: drafts.map(({ id: _id, ...volume }) => volume)
      });
      await onSaved();
      setFeedback("Saved volume overrides.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save volume overrides right now."
      );
    }
  }

  function handleReset() {
    setDrafts(toDraft(volumes));
    setNewSource("");
    setNewTarget("");
    setFeedback(null);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDrive size={14} />
          Volume Overrides
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Add DaoFlow-managed mounts that should be appended to the source compose service on the
          next deployment.
        </p>
        <div className="flex items-center gap-2 mb-4">
          <Input
            placeholder="Host path or volume name"
            value={newSource}
            onChange={(event) => setNewSource(event.target.value)}
            className="h-8 text-sm font-mono flex-1"
            data-testid={`service-volume-source-${serviceId}`}
          />
          <span className="text-muted-foreground">:</span>
          <Input
            placeholder="Container path"
            value={newTarget}
            onChange={(event) => setNewTarget(event.target.value)}
            className="h-8 text-sm font-mono flex-1"
            data-testid={`service-volume-target-${serviceId}`}
          />
          <Button
            size="sm"
            onClick={addVolume}
            disabled={!newSource.trim() || !newTarget.trim()}
            data-testid={`service-volume-add-${serviceId}`}
          >
            <Plus size={14} className="mr-1" />
            Add
          </Button>
        </div>

        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No DaoFlow-managed volume overrides saved.
          </p>
        ) : (
          <div className="space-y-2">
            {drafts.map((volume) => (
              <div
                key={volume.id}
                className="flex items-center justify-between py-2 px-3 rounded border"
                data-testid={`service-volume-row-${serviceId}-${volume.id}`}
              >
                <div className="flex items-center gap-2 font-mono text-sm">
                  <span>{volume.source}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>{volume.target}</span>
                  <button
                    className="inline-flex"
                    onClick={() => toggleMode(volume.id)}
                    type="button"
                  >
                    <Badge variant="outline" className="text-xs">
                      {volume.mode}
                    </Badge>
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => removeVolume(volume.id)}
                  data-testid={`service-volume-remove-${serviceId}-${volume.id}`}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {feedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-volume-feedback-${serviceId}`}
          >
            {feedback}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-volume-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-volume-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {updateRuntimeConfig.isPending ? "Saving..." : "Save Overrides"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
