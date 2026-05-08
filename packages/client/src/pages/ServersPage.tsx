import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, RefreshCw } from "lucide-react";
import {
  RegisterServerDialog,
  type RegisterServerFormData
} from "@/components/RegisterServerDialog";
import { QueryErrorRetry } from "@/components/QueryErrorRetry";
import {
  ServerCheckCard,
  SummaryCard,
  type ServerCheck
} from "@/components/servers/ServerCheckCard";
import { queryErrorMessage } from "@/lib/query-error-message";

export default function ServersPage() {
  const session = useSession();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: Boolean(session.data) });
  const viewer = trpc.viewer.useQuery(undefined, { enabled: Boolean(session.data) });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canManageServers = Boolean(viewer.data?.authz.capabilities.includes("server:write"));

  const registerServer = trpc.registerServer.useMutation({
    onSuccess: async (server) => {
      await utils.serverReadiness.invalidate();
      setFeedback(`Registered ${server.name}. Current readiness: ${server.status}.`);
      setDialogOpen(false);
    },
    onError: (error) =>
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to register the server.")
  });

  function handleRegister(data: RegisterServerFormData) {
    registerServer.mutate(data);
  }

  const checks = (serverReadiness.data?.checks ?? []) as ServerCheck[];
  const summary = serverReadiness.data?.summary;

  return (
    <main className="shell space-y-6" data-testid="servers-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Manage Docker hosts, inspect readiness checks, and register new engine or Swarm manager
            targets.
          </p>
        </div>
        {canManageServers ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void serverReadiness.refetch()}
              disabled={serverReadiness.isFetching}
            >
              <RefreshCw
                size={14}
                className={`mr-1 ${serverReadiness.isFetching ? "animate-spin" : ""}`}
              />
              Refresh All
            </Button>
            <RegisterServerDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              onSubmit={handleRegister}
              isPending={registerServer.isPending}
            />
          </div>
        ) : null}
      </div>

      {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}

      {serverReadiness.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      ) : serverReadiness.isError ? (
        <QueryErrorRetry
          message={queryErrorMessage(serverReadiness.error, "Unable to load server readiness.")}
          onRetry={() => void serverReadiness.refetch()}
          isRetrying={serverReadiness.isFetching}
        />
      ) : (
        <>
          {summary ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Servers" value={summary.totalServers} />
              <SummaryCard label="Ready" value={summary.readyServers} />
              <SummaryCard label="Attention" value={summary.attentionServers} />
              <SummaryCard
                label="Avg latency"
                value={summary.averageLatencyMs === null ? "n/a" : `${summary.averageLatencyMs} ms`}
              />
            </div>
          ) : null}

          {checks.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
                <Server size={28} className="text-primary/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No servers registered</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add your first target to start deploying.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {checks.map((check) => (
                <ServerCheckCard
                  key={String(check.serverId)}
                  check={check}
                  onOpen={(serverId) => void navigate(`/servers/${serverId}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

export { ServerCheckCard } from "@/components/servers/ServerCheckCard";
