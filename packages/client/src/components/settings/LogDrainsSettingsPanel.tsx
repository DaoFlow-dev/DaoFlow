import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

function readMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation failed.";
}

export function LogDrainsSettingsPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const drains = trpc.logDrains.useQuery();
  const deliveries = trpc.logDrainDeliveries.useQuery({ limit: 20 });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [drainName, setDrainName] = useState("");
  const [drainEndpoint, setDrainEndpoint] = useState("");

  const createDrain = trpc.createLogDrain.useMutation();
  const testDrain = trpc.testLogDrain.useMutation();
  const retryDelivery = trpc.retryLogDrainDelivery.useMutation();
  const deleteDrain = trpc.deleteLogDrain.useMutation();

  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback(null);
    try {
      await action();
      setFeedback(message);
      await Promise.all([utils.logDrains.invalidate(), utils.logDrainDeliveries.invalidate()]);
    } catch (error) {
      setFeedback(readMessage(error));
    }
  };

  return (
    <section className="space-y-4" data-testid="log-drains-panel">
      {feedback ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{feedback}</p>
      ) : null}
      <div>
        <h2 className="text-lg font-semibold">Log drains</h2>
        <p className="text-sm text-muted-foreground">
          Configure, test, monitor, and retry external log delivery targets.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
        <Input
          aria-label="Log drain name"
          data-testid="log-drain-name-input"
          placeholder="Ops webhook"
          value={drainName}
          onChange={(event) => setDrainName(event.target.value)}
        />
        <Input
          aria-label="Log drain endpoint"
          data-testid="log-drain-endpoint-input"
          placeholder="https://logs.example.com/ingest"
          value={drainEndpoint}
          onChange={(event) => setDrainEndpoint(event.target.value)}
        />
        <Button
          data-testid="create-log-drain-button"
          disabled={!canManage || !drainName || !drainEndpoint}
          onClick={() =>
            void run(
              () =>
                createDrain.mutateAsync({
                  name: drainName,
                  destinationType: "generic_http",
                  endpointUrl: drainEndpoint
                }),
              "Log drain configured."
            )
          }
        >
          Add drain
        </Button>
      </div>
      <div className="grid gap-2">
        {(drains.data ?? []).map((drain) => (
          <div key={drain.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{drain.name}</p>
                <p className="text-xs text-muted-foreground">
                  {drain.destinationType} · {drain.status} · {drain.lastError ?? "healthy"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`test-log-drain-${drain.id}`}
                  disabled={!canManage}
                  onClick={() =>
                    void run(
                      () => testDrain.mutateAsync({ drainId: drain.id }),
                      "Log drain test completed."
                    )
                  }
                >
                  <Send size={14} /> Test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`delete-log-drain-${drain.id}`}
                  disabled={!canManage}
                  onClick={() =>
                    void run(
                      () => deleteDrain.mutateAsync({ drainId: drain.id }),
                      "Log drain deleted."
                    )
                  }
                >
                  <Trash2 size={14} /> Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {(deliveries.data ?? []).map((delivery) => (
          <div key={delivery.id} className="flex items-center justify-between border-t py-2">
            <span className="text-sm">
              {delivery.status} · HTTP {delivery.httpStatus ?? "n/a"} · {delivery.id}
            </span>
            {delivery.status === "failed" ? (
              <Button
                size="sm"
                variant="outline"
                data-testid={`retry-log-drain-delivery-${delivery.id}`}
                disabled={!canManage}
                onClick={() =>
                  void run(
                    () => retryDelivery.mutateAsync({ deliveryId: delivery.id }),
                    "Log drain delivery retried."
                  )
                }
              >
                Retry
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
