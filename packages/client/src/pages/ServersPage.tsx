import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Server, XCircle, RefreshCw } from "lucide-react";
import {
  RegisterServerDialog,
  type RegisterServerFormData
} from "@/components/RegisterServerDialog";

export default function ServersPage() {
  const session = useSession();
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

  const checks = serverReadiness.data?.checks ?? [];
  const summary = serverReadiness.data?.summary;

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Manage Docker hosts, inspect readiness checks, and register new targets.
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
              <RefreshCw size={14} className={`mr-1 ${serverReadiness.isFetching ? "animate-spin" : ""}`} />
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
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Server size={32} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No servers registered yet. Add the first target to start deploying.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {checks.map((check) => (
                <Card key={String(check.serverId)}>
                  <CardHeader className="gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{String(check.serverName)}</CardTitle>
                        <CardDescription>
                          {String(check.serverHost)} · SSH {String(check.sshPort)}
                        </CardDescription>
                      </div>
                      <Badge variant={check.sshReachable ? "default" : "destructive"}>
                        {check.sshReachable ? "Ready" : "Attention"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <CapabilityBadge
                        ok={check.sshReachable}
                        label={`SSH ${check.sshReachable ? "reachable" : "blocked"}`}
                      />
                      <CapabilityBadge
                        ok={check.dockerReachable}
                        label={`Docker ${check.dockerReachable ? "reachable" : "blocked"}`}
                      />
                      <CapabilityBadge
                        ok={check.composeReachable}
                        label={`Compose ${check.composeReachable ? "reachable" : "blocked"}`}
                      />
                    </div>

                    <div className="text-sm text-muted-foreground">
                      Checked {new Date(String(check.checkedAt)).toLocaleString()}
                      {check.latencyMs !== null ? ` · ${check.latencyMs} ms` : ""}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm font-medium">Issues</p>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {check.issues.length > 0 ? (
                            check.issues.map((issue) => <li key={issue}>{issue}</li>)
                          ) : (
                            <li>No open issues.</li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium">Recommended Actions</p>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {check.recommendedActions.length > 0 ? (
                            check.recommendedActions.map((action) => <li key={action}>{action}</li>)
                          ) : (
                            <li>No action required.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function CapabilityBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
      {ok ? (
        <CheckCircle2 size={14} className="text-emerald-500" />
      ) : (
        <XCircle size={14} className="text-red-500" />
      )}
      <span>{label}</span>
    </div>
  );
}
