import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerReadinessIndicator } from "@/components/ServerReadinessIndicator";
import {
  DashboardOperationalAttention,
  type DashboardDeploymentSummary,
  type DashboardServerCheck
} from "@/components/dashboard/DashboardOperationalAttention";
import {
  DashboardQueryAlerts,
  type DashboardQueryIssue
} from "@/components/dashboard/DashboardQueryAlerts";
import { DashboardRecentActivity } from "@/components/dashboard/DashboardRecentActivity";
import { DashboardStatsGrid, type DashboardStat } from "@/components/dashboard/DashboardStatsGrid";
import { queryErrorMessage } from "@/lib/query-error-message";
import { getServerReadinessTone } from "@/lib/tone-utils";
import { Activity, FolderKanban, Plus, Rocket, Server } from "lucide-react";

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = useSession();
  const loggedIn = Boolean(session.data);

  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: loggedIn });
  const recentDeployments = trpc.recentDeployments.useQuery({ limit: 10 }, { enabled: loggedIn });
  const infra = trpc.infrastructureInventory.useQuery(undefined, { enabled: loggedIn });

  const servers = infra.data?.servers ?? [];
  const projects = infra.data?.projects ?? [];
  const deployments = (recentDeployments.data ?? []) as DashboardDeploymentSummary[];
  const checks = (serverReadiness.data?.checks ?? []) as DashboardServerCheck[];
  const totalServices =
    infra.data?.summary && "totalServices" in infra.data.summary
      ? Number(infra.data.summary.totalServices ?? 0)
      : projects.reduce((sum, project) => sum + Number(project.serviceCount ?? 0), 0);

  const stats: DashboardStat[] = [
    {
      label: "Servers",
      value: servers.length,
      icon: Server,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      href: "/servers"
    },
    {
      label: "Projects",
      value: projects.length,
      icon: FolderKanban,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
      href: "/projects"
    },
    {
      label: "Deployments",
      value: deployments.length,
      icon: Rocket,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      href: "/deployments"
    },
    {
      label: "Services",
      value: totalServices,
      icon: Activity,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      href: "/projects"
    }
  ];

  const queryIssues: DashboardQueryIssue[] = [];
  if (infra.isError) {
    queryIssues.push({
      key: "infrastructure",
      title: "Infrastructure inventory did not load",
      message: queryErrorMessage(infra.error, "Unable to load infrastructure inventory."),
      isRetrying: Boolean(infra.isFetching),
      onRetry: () => void infra.refetch()
    });
  }
  if (serverReadiness.isError) {
    queryIssues.push({
      key: "server-readiness",
      title: "Server readiness did not load",
      message: queryErrorMessage(serverReadiness.error, "Unable to load server readiness."),
      isRetrying: Boolean(serverReadiness.isFetching),
      onRetry: () => void serverReadiness.refetch()
    });
  }

  const attentionServers = checks.filter((check) => {
    const tone = getServerReadinessTone(String(check.readinessStatus ?? ""));
    return tone === "failed" || tone === "running" || check.dockerReachable === false;
  });
  const attentionDeployments = deployments.filter((deployment) => {
    const tone = String(deployment.statusTone ?? "");
    const status = String(deployment.status ?? "").toLowerCase();
    return tone === "failed" || status === "failed";
  });

  return (
    <main className="shell space-y-6" data-testid="dashboard-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of your infrastructure and recent activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="shadow-sm" onClick={() => void navigate("/projects")}>
            <Plus className="mr-1.5 h-4 w-4" /> New Project
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="shadow-sm"
            onClick={() => void navigate("/servers")}
          >
            <Server className="mr-1.5 h-4 w-4" /> Add Server
          </Button>
        </div>
      </div>

      <DashboardQueryAlerts issues={queryIssues} />

      <DashboardStatsGrid stats={stats} onOpen={(href) => void navigate(href)} />

      <DashboardOperationalAttention
        attentionServers={attentionServers}
        attentionDeployments={attentionDeployments}
        onOpenDeploy={() => void navigate("/deploy")}
        onReviewServers={() => void navigate("/servers")}
        onReviewDeployments={() => void navigate("/deployments")}
      />

      {checks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Server Health</CardTitle>
            <CardDescription>Connectivity status of registered servers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {checks.map((server) => (
                <div
                  key={String(server.serverId)}
                  data-testid={`server-health-${String(server.serverId)}`}
                  className="flex items-center gap-3 rounded-xl border bg-card/50 p-4 transition-all duration-200 hover:border-primary/10 hover:shadow-sm"
                >
                  <ServerReadinessIndicator
                    readinessStatus={String(server.readinessStatus)}
                    dataTestId={`server-status-${String(server.serverId)}`}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{String(server.serverName)}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(server.serverHost)} · Docker{" "}
                      {server.dockerReachable ? "reachable" : "blocked"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DashboardRecentActivity
        deployments={deployments}
        isLoading={recentDeployments.isLoading}
        errorMessage={
          recentDeployments.isError
            ? queryErrorMessage(recentDeployments.error, "Unable to load recent deployments.")
            : null
        }
        isRetrying={recentDeployments.isFetching}
        onRetry={() => void recentDeployments.refetch()}
        onOpenDeployments={() => void navigate("/deployments")}
        onCreateProject={() => void navigate("/projects")}
        onOpenService={(serviceId) => void navigate(`/services/${serviceId}`)}
      />
    </main>
  );
}
