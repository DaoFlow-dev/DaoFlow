import { Fragment, useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Rocket, ChevronDown, ChevronRight, RotateCcw, RefreshCw } from "lucide-react";
import DeploymentLogViewer from "../components/DeploymentLogViewer";
import DeploymentRollbackDialog from "../components/DeploymentRollbackDialog";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

function formatRelative(iso: string | Date | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function DeploymentsPage() {
  const session = useSession();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rollbackServiceId, setRollbackServiceId] = useState<string | null>(null);

  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const deployments = recentDeployments.data ?? [];

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <main className="shell space-y-6" data-testid="deployments-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          View deployment history, logs, and rollback options.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deployment History</CardTitle>
          <CardDescription>
            {deployments.length} deployment
            {deployments.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentDeployments.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Rocket size={32} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No deployments yet. Queue your first deployment to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((d) => {
                  const id = String(d.id);
                  const isExpanded = expandedId === id;
                  const lifecycleStatus =
                    typeof d.lifecycleStatus === "string" ? d.lifecycleStatus : String(d.status);
                  const isSuccessful = d.canRollback === true && typeof d.serviceId === "string";
                  const actorLabel =
                    typeof d.requestedByEmail === "string" && d.requestedByEmail.length > 0
                      ? d.requestedByEmail
                      : "system";

                  return (
                    <Fragment key={id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(id)}
                      >
                        <TableCell className="px-2">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </TableCell>
                        <TableCell className="font-medium">
                          {String(d.serviceName ?? d.projectId ?? "—")}
                          <div className="text-xs font-normal text-muted-foreground">
                            {String(d.environmentName ?? "unknown environment")} on{" "}
                            {String(d.targetServerName ?? "unknown server")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={getBadgeVariantFromTone(d.statusTone)}>
                              {d.statusLabel}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Lifecycle: {lifecycleStatus}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {String(d.sourceType ?? "docker")}
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground"
                          title={d.createdAt ? new Date(d.createdAt).toLocaleString() : undefined}
                        >
                          {formatRelative(d.createdAt ?? null)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isSuccessful && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Rollback deployment"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRollbackServiceId(String(d.serviceId));
                              }}
                            >
                              <RotateCcw size={14} className="mr-1" />
                              Rollback
                            </Button>
                          )}
                          {typeof d.conclusion === "string" && d.conclusion === "failure" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="Retry failed deployment"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                            >
                              <RefreshCw size={14} className="mr-1" />
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={6} className="p-0">
                            <div className="space-y-4 bg-muted/20 p-4">
                              <div className="grid gap-3 md:grid-cols-4">
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Actor
                                  </p>
                                  <p className="text-sm font-medium">{actorLabel}</p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Commit
                                  </p>
                                  <p className="text-sm font-medium">
                                    {String(d.commitSha ?? "—")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Image
                                  </p>
                                  <p className="truncate text-sm font-medium">
                                    {String(d.imageTag ?? "—")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Outcome
                                  </p>
                                  <p className="text-sm font-medium">
                                    {typeof d.conclusion === "string" ? d.conclusion : "pending"}
                                  </p>
                                </div>
                              </div>
                              {Array.isArray(d.steps) && d.steps.length > 0 ? (
                                <div className="space-y-2">
                                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Structured steps
                                  </p>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {d.steps.map((step) => (
                                      <div
                                        key={String(step.id)}
                                        className="rounded-md border bg-background p-3"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-sm font-medium">
                                            {String(step.label)}
                                          </p>
                                          <Badge variant="outline">
                                            {typeof step.status === "string"
                                              ? step.status
                                              : "pending"}
                                          </Badge>
                                        </div>
                                        {typeof step.detail === "string" &&
                                        step.detail.length > 0 ? (
                                          <p className="mt-1 text-sm text-muted-foreground">
                                            {step.detail}
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              <DeploymentLogViewer deploymentId={id} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {rollbackServiceId && (
        <DeploymentRollbackDialog
          serviceId={rollbackServiceId}
          open={!!rollbackServiceId}
          onOpenChange={(open) => {
            if (!open) setRollbackServiceId(null);
          }}
          onRolledBack={() => void recentDeployments.refetch()}
        />
      )}
    </main>
  );
}
