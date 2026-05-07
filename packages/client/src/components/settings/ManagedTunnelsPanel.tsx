import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

function readMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation failed.";
}

export function ManagedTunnelsPanel({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const tunnels = trpc.managedTunnels.useQuery();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tunnelName, setTunnelName] = useState("");
  const [tunnelDomain, setTunnelDomain] = useState("");
  const [routeTunnelId, setRouteTunnelId] = useState("");
  const [routeHostname, setRouteHostname] = useState("");
  const [routeService, setRouteService] = useState("");
  const [rotateTunnelId, setRotateTunnelId] = useState("");
  const [rotateCredentials, setRotateCredentials] = useState("");

  const createTunnel = trpc.createManagedTunnel.useMutation();
  const syncRoutes = trpc.syncManagedTunnelRoutes.useMutation();
  const rotateTunnel = trpc.rotateManagedTunnelCredentials.useMutation();

  const run = async (action: () => Promise<unknown>, message: string) => {
    setFeedback(null);
    try {
      await action();
      setFeedback(message);
      await utils.managedTunnels.invalidate();
    } catch (error) {
      setFeedback(readMessage(error));
    }
  };

  return (
    <section className="space-y-4" data-testid="managed-tunnels-panel">
      {feedback ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{feedback}</p>
      ) : null}
      <div>
        <h2 className="text-lg font-semibold">Managed tunnels</h2>
        <p className="text-sm text-muted-foreground">
          Explicit tunnel inventory, observed route sync, and credential rotation.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="tunnel-name">Name</Label>
          <Input
            id="tunnel-name"
            data-testid="tunnel-name-input"
            value={tunnelName}
            onChange={(event) => setTunnelName(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tunnel-domain">Domain</Label>
          <Input
            id="tunnel-domain"
            data-testid="tunnel-domain-input"
            value={tunnelDomain}
            onChange={(event) => setTunnelDomain(event.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button
            data-testid="create-tunnel-button"
            disabled={!canManage || !tunnelName.trim()}
            onClick={() =>
              void run(
                () =>
                  createTunnel.mutateAsync({
                    name: tunnelName.trim(),
                    domain: tunnelDomain.trim() || null
                  }),
                "Managed tunnel registered."
              )
            }
          >
            Register
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Input
          aria-label="Tunnel ID"
          data-testid="route-tunnel-id-input"
          placeholder="Tunnel ID"
          value={routeTunnelId}
          onChange={(event) => setRouteTunnelId(event.target.value)}
        />
        <Input
          aria-label="Route hostname"
          data-testid="route-hostname-input"
          placeholder="app.example.com"
          value={routeHostname}
          onChange={(event) => setRouteHostname(event.target.value)}
        />
        <Input
          aria-label="Route service"
          data-testid="route-service-input"
          placeholder="web:3000"
          value={routeService}
          onChange={(event) => setRouteService(event.target.value)}
        />
        <Button
          data-testid="sync-tunnel-route-button"
          disabled={!canManage || !routeTunnelId || !routeHostname || !routeService}
          onClick={() =>
            void run(
              () =>
                syncRoutes.mutateAsync({
                  tunnelId: routeTunnelId,
                  routes: [{ hostname: routeHostname, service: routeService, status: "active" }]
                }),
              "Tunnel routes synced."
            )
          }
        >
          Sync route
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
        <Input
          aria-label="Rotate tunnel ID"
          data-testid="rotate-tunnel-id-input"
          placeholder="Tunnel ID"
          value={rotateTunnelId}
          onChange={(event) => setRotateTunnelId(event.target.value)}
        />
        <Input
          aria-label="Replacement tunnel credentials"
          data-testid="rotate-tunnel-credentials-input"
          placeholder="Replacement credentials JSON"
          value={rotateCredentials}
          onChange={(event) => setRotateCredentials(event.target.value)}
        />
        <Button
          variant="outline"
          data-testid="rotate-tunnel-button"
          disabled={!canManage || !rotateTunnelId || !rotateCredentials}
          onClick={() =>
            void run(
              () =>
                rotateTunnel.mutateAsync({
                  tunnelId: rotateTunnelId,
                  credentials: rotateCredentials
                }),
              "Tunnel credentials rotated."
            )
          }
        >
          <RotateCw size={14} /> Rotate
        </Button>
      </div>

      <div className="grid gap-2">
        {(tunnels.data ?? []).map((tunnel) => (
          <div key={tunnel.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{tunnel.name}</p>
                <p className="text-xs text-muted-foreground">
                  {tunnel.id} · {tunnel.status} · {tunnel.domain ?? "no domain"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{tunnel.routes.length} routes</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
