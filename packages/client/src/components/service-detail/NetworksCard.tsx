import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Network, Plus, RotateCcw, Save } from "lucide-react";

interface NetworksCardProps {
  serviceId: string;
  networks: string[];
  onSaved: () => Promise<unknown>;
}

export function NetworksCard({ serviceId, networks, onSaved }: NetworksCardProps) {
  const [drafts, setDrafts] = useState<string[]>(networks);
  const [newNetwork, setNewNetwork] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();

  useEffect(() => {
    setDrafts(networks);
  }, [networks]);

  const isDirty = JSON.stringify(drafts) !== JSON.stringify(networks);

  function addNetwork() {
    const value = newNetwork.trim();
    if (!value || drafts.includes(value)) {
      return;
    }

    setDrafts((previous) => [...previous, value]);
    setNewNetwork("");
  }

  function removeNetwork(name: string) {
    setDrafts((previous) => previous.filter((network) => network !== name));
  }

  async function handleSave() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        networks: drafts
      });
      await onSaved();
      setFeedback("Saved network overrides.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save network overrides right now."
      );
    }
  }

  function handleReset() {
    setDrafts(networks);
    setNewNetwork("");
    setFeedback(null);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Network size={14} />
          Network Overrides
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Add extra network attachments that DaoFlow should append to the compose service on the
          next deployment.
        </p>
        <div className="flex items-center gap-2 mb-4">
          <Input
            placeholder="Network name"
            value={newNetwork}
            onChange={(event) => setNewNetwork(event.target.value)}
            className="h-8 text-sm flex-1"
            onKeyDown={(event) => event.key === "Enter" && addNetwork()}
            data-testid={`service-network-input-${serviceId}`}
          />
          <Button
            size="sm"
            onClick={addNetwork}
            disabled={!newNetwork.trim()}
            data-testid={`service-network-add-${serviceId}`}
          >
            <Plus size={14} className="mr-1" />
            Add
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center w-full">
              No DaoFlow-managed network overrides saved.
            </p>
          ) : (
            drafts.map((network) => (
              <Badge
                key={network}
                variant="secondary"
                className="gap-1 pr-1"
                data-testid={`service-network-badge-${serviceId}-${network}`}
              >
                {network}
                <button
                  className="ml-1 hover:text-destructive"
                  onClick={() => removeNetwork(network)}
                  type="button"
                >
                  ×
                </button>
              </Badge>
            ))
          )}
        </div>

        {feedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-network-feedback-${serviceId}`}
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
            data-testid={`service-network-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-network-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {updateRuntimeConfig.isPending ? "Saving..." : "Save Overrides"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
