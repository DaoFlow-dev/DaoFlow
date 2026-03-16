import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Server, FolderKanban, Rocket, Activity, CheckCircle2, XCircle } from "lucide-react";

export default function DashboardPage() {
  const session = useSession();

  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: Boolean(session.data) });
  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 5 },
    { enabled: Boolean(session.data) }
  );
  const infra = trpc.infrastructureInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });

  const servers = infra.data?.servers ?? [];
  const projects = infra.data?.projects ?? [];
  const deployments = recentDeployments.data ?? [];
  const checks = serverReadiness.data?.checks ?? [];

  const stats = [
    {
      label: "Servers",
      value: servers.length,
      icon: Server,
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    {
      label: "Projects",
      value: projects.length,
      icon: FolderKanban,
      color: "text-purple-600",
      bg: "bg-purple-50"
    },
    {
      label: "Deployments",
      value: deployments.length,
      icon: Rocket,
      color: "text-amber-600",
      bg: "bg-amber-50"
    },
    {
      label: "Services",
      value: infra.data?.environments?.length ?? 0,
      icon: Activity,
      color: "text-emerald-600",
      bg: "bg-emerald-50"
    }
  ];

  return (
    <main className="shell space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Overview of your infrastructure and recent activity.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${s.bg}`}
              >
                <s.icon size={20} className={s.color} />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Server Health */}
      {checks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server Health</CardTitle>
            <CardDescription>Connectivity status of registered servers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {checks.map((s) => (
                <div
                  key={String(s.serverId)}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  {s.sshReachable ? (
                    <CheckCircle2 size={18} className="text-emerald-500" />
                  ) : (
                    <XCircle size={18} className="text-red-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{String(s.serverName)}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(s.serverHost)} · Docker {s.dockerReachable ? "✓" : "✗"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Deployments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Deployments</CardTitle>
          <CardDescription>Latest deployment activity</CardDescription>
        </CardHeader>
        <CardContent>
          {recentDeployments.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : deployments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No deployments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((d) => (
                  <TableRow key={String(d.id)}>
                    <TableCell className="font-medium">
                      {String(d.serviceName ?? d.projectId ?? "—")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "healthy"
                            ? "default"
                            : d.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {String(d.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {String(d.sourceType ?? "docker")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
