import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorRetry } from "@/components/QueryErrorRetry";
import { getBadgeVariantFromTone, getToneTextClass } from "@/lib/tone-utils";
import { Clock, GitBranch, Plus, Rocket, Search } from "lucide-react";
import type { DashboardDeploymentSummary } from "./DashboardOperationalAttention";

function formatRelative(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DashboardRecentActivity({
  deployments,
  isLoading,
  errorMessage,
  isRetrying,
  onRetry,
  onOpenDeployments,
  onCreateProject,
  onOpenService
}: {
  deployments: DashboardDeploymentSummary[];
  isLoading: boolean;
  errorMessage?: string | null;
  isRetrying?: boolean;
  onRetry: () => void;
  onOpenDeployments: () => void;
  onCreateProject: () => void;
  onOpenService: (serviceId: string) => void;
}) {
  const [activitySearch, setActivitySearch] = useState("");
  const filteredDeployments = activitySearch
    ? deployments.filter((deployment) =>
        String(deployment.serviceName ?? deployment.projectId ?? "")
          .toLowerCase()
          .includes(activitySearch.toLowerCase())
      )
    : deployments;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold">Recent Activity</CardTitle>
          <CardDescription>Latest deployment and build events</CardDescription>
        </div>
        <Button size="sm" variant="ghost" className="text-xs" onClick={onOpenDeployments}>
          View all
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : errorMessage ? (
          <div data-testid="dashboard-recent-activity-error">
            <QueryErrorRetry message={errorMessage} onRetry={onRetry} isRetrying={isRetrying} />
          </div>
        ) : deployments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
              <Rocket size={28} className="text-primary/60" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">No deployments yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                Create a project and deploy your first service to see activity here.
              </p>
            </div>
            <Button size="sm" onClick={onCreateProject}>
              <Plus className="mr-1.5 h-4 w-4" />
              Create Project
            </Button>
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Filter activity by service name..."
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
                className="h-8 pl-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              {filteredDeployments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No matching deployments for &ldquo;{activitySearch}&rdquo;
                </p>
              ) : (
                filteredDeployments.map((deployment) => (
                  <button
                    type="button"
                    key={String(deployment.id)}
                    disabled={!deployment.serviceId}
                    className="group flex w-full items-center gap-4 rounded-xl border border-transparent bg-muted/30 p-4 text-left transition-all duration-200 hover:border-border hover:bg-accent/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-muted/30 disabled:hover:shadow-none"
                    onClick={() => {
                      if (deployment.serviceId) onOpenService(deployment.serviceId);
                    }}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted transition-transform duration-200 group-hover:scale-105">
                      <Rocket
                        size={16}
                        className={getToneTextClass(deployment.statusTone ?? "neutral")}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {String(deployment.serviceName ?? deployment.projectId ?? "-")}
                        </span>
                        <Badge
                          variant={getBadgeVariantFromTone(deployment.statusTone ?? "neutral")}
                          className="px-1.5 py-0 text-[11px]"
                        >
                          {deployment.statusLabel}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <GitBranch size={12} />
                          {String(deployment.sourceType ?? "docker")}
                        </span>
                        {deployment.createdAt ? (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatRelative(deployment.createdAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
