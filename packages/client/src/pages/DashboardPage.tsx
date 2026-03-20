import { useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getBadgeVariantFromTone, getToneTextClass } from "@/lib/tone-utils";
import {
  Server,
  FolderKanban,
  Rocket,
  Activity,
  CheckCircle2,
  XCircle,
  Plus,
  Clock,
  GitBranch,
  Search
} from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/* ──────────────────────────── helpers ──────────────────────────── */

function formatRelative(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ──────────────────────────── page ──────────────────────────── */

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = useSession();
  const loggedIn = Boolean(session.data);

  const serverReadiness = trpc.serverReadiness.useQuery({}, { enabled: loggedIn });
  const recentDeployments = trpc.recentDeployments.useQuery({ limit: 10 }, { enabled: loggedIn });
  const infra = trpc.infrastructureInventory.useQuery(undefined, { enabled: loggedIn });

  const servers = infra.data?.servers ?? [];
  const projects = infra.data?.projects ?? [];
  const deployments = recentDeployments.data ?? [];
  const checks = serverReadiness.data?.checks ?? [];
  const totalServices =
    infra.data?.summary && "totalServices" in infra.data.summary
      ? Number(infra.data.summary.totalServices ?? 0)
      : projects.reduce((sum, p) => sum + Number(p.serviceCount ?? 0), 0);

  const stats = [
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

  const [activitySearch, setActivitySearch] = useState("");
  const filteredDeployments = activitySearch
    ? deployments.filter((d) =>
        String(d.serviceName ?? d.projectId ?? "")
          .toLowerCase()
          .includes(activitySearch.toLowerCase())
      )
    : deployments;

  return (
    <main className="shell space-y-6" data-testid="dashboard-page">
      {/* Header + quick actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card
            key={s.label}
            className="group relative cursor-pointer overflow-hidden border-transparent bg-gradient-to-br from-card to-card/80 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-primary/10"
            onClick={() => void navigate(s.href)}
          >
            <div
              className="absolute inset-0 bg-gradient-to-br from-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{
                backgroundImage: `linear-gradient(135deg, transparent 60%, ${s.color.includes("blue") ? "rgba(59,130,246,0.04)" : s.color.includes("purple") ? "rgba(168,85,247,0.04)" : s.color.includes("amber") ? "rgba(245,158,11,0.04)" : "rgba(16,185,129,0.04)"})`
              }}
            />
            <CardContent className="relative flex items-center gap-4 p-5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.bg} transition-transform duration-300 group-hover:scale-110`}
              >
                <s.icon size={20} className={s.color} />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{s.value}</p>
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Server Health */}
      {checks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Server Health</CardTitle>
            <CardDescription>Connectivity status of registered servers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {checks.map((s) => (
                <div
                  key={String(s.serverId)}
                  className="flex items-center gap-3 rounded-xl border bg-card/50 p-4 transition-all duration-200 hover:border-primary/10 hover:shadow-sm"
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

      {/* Recent Activity — timeline style */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
            <CardDescription>Latest deployment and build events</CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => void navigate("/deployments")}
          >
            View all
          </Button>
        </CardHeader>
        <CardContent>
          {recentDeployments.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : deployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
                <Rocket size={28} className="text-primary/60" />
              </div>
              <div className="text-center">
                <p className="font-medium text-foreground">No deployments yet</p>
                <p className="text-sm mt-1.5 max-w-xs text-muted-foreground">
                  Create a project and deploy your first service to see activity here.
                </p>
              </div>
              <Button size="sm" onClick={() => void navigate("/projects")}>
                <Plus className="mr-1.5 h-4 w-4" />
                Create Project
              </Button>
            </div>
          ) : (
            <>
              {/* Activity search */}
              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Filter activity by service name..."
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  className="h-8 pl-9 text-sm"
                />
              </div>
              <div className="space-y-2">
                {filteredDeployments.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No matching deployments for &ldquo;{activitySearch}&rdquo;
                  </p>
                ) : (
                  filteredDeployments.map((d) => (
                    <div
                      key={String(d.id)}
                      className="group flex cursor-pointer items-center gap-4 rounded-xl border border-transparent bg-muted/30 p-4 transition-all duration-200 hover:border-border hover:bg-accent/50 hover:shadow-sm"
                      onClick={() => {
                        if (d.serviceId) void navigate(`/services/${d.serviceId}`);
                      }}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted transition-transform duration-200 group-hover:scale-105">
                        <Rocket size={16} className={getToneTextClass(d.statusTone)} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {String(d.serviceName ?? d.projectId ?? "—")}
                          </span>
                          <Badge
                            variant={getBadgeVariantFromTone(d.statusTone)}
                            className="px-1.5 py-0 text-[11px]"
                          >
                            {d.statusLabel}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <GitBranch size={12} />
                            {String(d.sourceType ?? "docker")}
                          </span>
                          {d.createdAt && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {formatRelative(d.createdAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
