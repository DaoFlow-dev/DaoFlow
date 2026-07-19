import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ChartNoAxesCombined,
  Gauge,
  HardDrive,
  History,
  Network,
  Shield,
  Terminal
} from "lucide-react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HostTerminalTab } from "@/components/server-detail/HostTerminalTab";
import { ServerCapacityPanel } from "@/components/server-detail/ServerCapacityPanel";
import { ServerHostIdentityPanel } from "@/components/server-detail/ServerHostIdentityPanel";
import { ServerMetricsPanel } from "@/components/server-detail/ServerMetricsPanel";
import {
  CleanupPanel,
  HistoryPanel,
  PatchingPanel,
  ResourcesPanel
} from "@/components/server-detail/ServerOperationPanels";
import { SwarmPanel } from "@/components/server-detail/ServerSwarmPanel";
import type { ServerOperationsHub } from "@/components/server-detail/server-operation-types";

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const utils = trpc.useUtils();
  const [includeVolumes, setIncludeVolumes] = useState(false);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const hub = trpc.serverOperationsHub.useQuery(
    { serverId: id!, limit: 30 },
    { enabled: Boolean(session.data && id) }
  );
  const viewer = trpc.viewer.useQuery(undefined, { enabled: Boolean(session.data) });
  const logs = trpc.serverOperationLogs.useQuery(
    { operationId: selectedOperationId ?? "", limit: 200 },
    { enabled: Boolean(selectedOperationId) }
  );
  const collectResources = trpc.collectServerResources.useMutation();
  const previewCleanup = trpc.previewServerCleanup.useMutation();
  const runCleanup = trpc.runServerCleanup.useMutation();
  const planPatches = trpc.planServerPatches.useMutation();
  const refreshSwarmTopology = trpc.refreshSwarmTopology.useMutation();
  const updateSwarmNodeAvailability = trpc.updateSwarmNodeAvailability.useMutation();
  const updateSwarmServiceScale = trpc.updateSwarmServiceScale.useMutation();

  const data = hub.data as ServerOperationsHub | undefined;
  const caps = viewer.data?.authz.capabilities ?? [];
  const canWriteServer = caps.includes("server:write");
  const canConfigureCapacity =
    canWriteServer && ["owner", "admin"].includes(viewer.data?.authz.role ?? "");
  const canConfigureMetrics =
    canWriteServer && ["owner", "admin"].includes(viewer.data?.authz.role ?? "");
  const canOpenTerminal = caps.includes("terminal:open");
  const isSwarmManager = data?.server.kind === "docker-swarm-manager";
  const operations = useMemo(() => data?.operations ?? [], [data?.operations]);
  const latestCleanupPreview = operations.find(
    (operation) => operation.kind === "cleanup_preview" && operation.status === "completed"
  );

  async function refreshHub(message: string) {
    setFeedback(message);
    await hub.refetch();
    await utils.serverReadiness.invalidate();
  }

  async function runMutation<T>(action: () => Promise<T>, message: string) {
    setFeedback(null);
    try {
      await action();
      await refreshHub(message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Server operation failed.");
    }
  }

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId),
    [operations, selectedOperationId]
  );

  if (hub.isLoading) {
    return (
      <main className="shell space-y-4">
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-36 w-full rounded-lg" />
        <Skeleton className="h-60 w-full rounded-lg" />
      </main>
    );
  }

  if (!data) {
    return (
      <main className="shell py-16 text-center text-muted-foreground">
        Server not found.
        <br />
        <Button variant="ghost" className="mt-4" onClick={() => void navigate("/servers")}>
          Back to Servers
        </Button>
      </main>
    );
  }

  return (
    <main className="shell space-y-6" data-testid={`server-detail-page-${data.server.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => void navigate("/servers")}>
            <ArrowLeft size={14} className="mr-1" />
            Servers
          </Button>
          <h1 className="font-display text-2xl font-bold tracking-tight">{data.server.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.server.host} · {data.server.kind}
          </p>
        </div>
        <Badge variant="outline" data-testid={`server-detail-status-${data.server.id}`}>
          {data.server.status}
        </Badge>
      </div>

      {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}

      <Tabs defaultValue="resources" className="w-full">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="resources" className="gap-1.5">
            <Activity size={14} />
            Resources
          </TabsTrigger>
          <TabsTrigger
            value="capacity"
            className="gap-1.5"
            data-testid={`server-detail-capacity-tab-${data.server.id}`}
          >
            <Gauge size={14} />
            Capacity
          </TabsTrigger>
          <TabsTrigger
            value="metrics"
            className="gap-1.5"
            data-testid={`server-detail-metrics-tab-${data.server.id}`}
          >
            <ChartNoAxesCombined size={14} />
            Metrics
          </TabsTrigger>
          <TabsTrigger value="cleanup" className="gap-1.5">
            <HardDrive size={14} />
            Cleanup
          </TabsTrigger>
          <TabsTrigger value="patches" className="gap-1.5">
            <Shield size={14} />
            Patching
          </TabsTrigger>
          <TabsTrigger
            value="identity"
            className="gap-1.5"
            data-testid={`server-detail-identity-tab-${data.server.id}`}
          >
            <Shield size={14} />
            Identity
          </TabsTrigger>
          {isSwarmManager ? (
            <TabsTrigger value="swarm" className="gap-1.5">
              <Network size={14} />
              Swarm
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="terminal" className="gap-1.5">
            <Terminal size={14} />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History size={14} />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="mt-4">
          <ResourcesPanel
            serverId={data.server.id}
            resource={data.latestResource}
            isPending={collectResources.isPending}
            onRefresh={() =>
              void runMutation(
                () => collectResources.mutateAsync({ serverId: data.server.id }),
                "Resource check completed."
              )
            }
          />
        </TabsContent>

        <TabsContent value="capacity" className="mt-4">
          <ServerCapacityPanel
            serverId={data.server.id}
            maxConcurrentBuilds={data.server.maxConcurrentBuilds ?? 1}
            maxQueuedDeployments={data.server.maxQueuedDeployments ?? 20}
            canManage={canConfigureCapacity}
            onSaved={() => refreshHub("Server capacity updated.")}
          />
        </TabsContent>

        <TabsContent value="metrics" className="mt-4">
          <ServerMetricsPanel
            serverId={data.server.id}
            canManage={canConfigureMetrics}
            onSaved={() => refreshHub("Metrics policy updated.")}
          />
        </TabsContent>

        <TabsContent value="cleanup" className="mt-4">
          <CleanupPanel
            canRun={canWriteServer}
            includeVolumes={includeVolumes}
            onIncludeVolumesChange={setIncludeVolumes}
            hasPreview={Boolean(latestCleanupPreview)}
            isPending={previewCleanup.isPending || runCleanup.isPending}
            onPreview={() =>
              void runMutation(
                () => previewCleanup.mutateAsync({ serverId: data.server.id, includeVolumes }),
                "Cleanup preview recorded."
              )
            }
            onRun={() =>
              void runMutation(
                () => runCleanup.mutateAsync({ serverId: data.server.id, includeVolumes }),
                "Cleanup run completed."
              )
            }
          />
        </TabsContent>

        <TabsContent value="patches" className="mt-4">
          <PatchingPanel
            canRun={canWriteServer}
            isPending={planPatches.isPending}
            latestPlan={operations.find((operation) => operation.kind === "patch_plan")}
            onPlan={() =>
              void runMutation(
                () => planPatches.mutateAsync({ serverId: data.server.id }),
                "Patch plan recorded."
              )
            }
          />
        </TabsContent>

        <TabsContent value="identity" className="mt-4">
          <ServerHostIdentityPanel serverId={data.server.id} canManage={canWriteServer} />
        </TabsContent>

        {isSwarmManager ? (
          <TabsContent value="swarm" className="mt-4">
            <SwarmPanel
              topology={data.server.swarmTopology}
              canRun={canWriteServer}
              isPending={
                refreshSwarmTopology.isPending ||
                updateSwarmNodeAvailability.isPending ||
                updateSwarmServiceScale.isPending
              }
              onRefreshTopology={() =>
                void runMutation(
                  () => refreshSwarmTopology.mutateAsync({ serverId: data.server.id }),
                  "Swarm topology refreshed."
                )
              }
              onNodeAvailability={(input) =>
                void runMutation(
                  () =>
                    updateSwarmNodeAvailability.mutateAsync({
                      serverId: data.server.id,
                      node: input.node,
                      availability: input.availability,
                      dryRun: input.dryRun
                    }),
                  input.dryRun ? "Swarm node plan recorded." : "Swarm node updated."
                )
              }
              onServiceScale={(input) =>
                void runMutation(
                  () =>
                    updateSwarmServiceScale.mutateAsync({
                      serverId: data.server.id,
                      service: input.service,
                      replicas: input.replicas,
                      dryRun: input.dryRun
                    }),
                  input.dryRun ? "Swarm scale plan recorded." : "Swarm service scaled."
                )
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="terminal" className="mt-4">
          {canOpenTerminal ? (
            <HostTerminalTab serverId={data.server.id} />
          ) : (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Host terminal access requires terminal:open.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryPanel
            operations={operations}
            selectedOperation={selectedOperation}
            logs={logs.data?.logs ?? []}
            onSelect={setSelectedOperationId}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
