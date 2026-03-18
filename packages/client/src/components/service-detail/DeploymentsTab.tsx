import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  XCircle,
  GitCompare,
  RotateCcw,
  Trash2,
  Timer
} from "lucide-react";
import { useState } from "react";
import {
  getBadgeVariantFromTone,
  getDeploymentStepTone,
  getDeploymentTone,
  getToneDotClass
} from "@/lib/tone-utils";

interface DeploymentsTabProps {
  serviceId: string;
  serviceName: string;
}

function formatDuration(start: string, end?: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function DeploymentsTab({ serviceId, serviceName }: DeploymentsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);

  const deployments = trpc.recentDeployments.useQuery({ limit: 50 });
  const rollbackTargets = trpc.rollbackTargets.useQuery({ serviceId });

  const cancelMutation = trpc.cancelDeployment.useMutation({
    onSuccess: () => void deployments.refetch()
  });

  const rollbackMutation = trpc.executeRollback.useMutation({
    onSuccess: () => void deployments.refetch()
  });

  // Filter deployments for this service
  const allServiceDeployments =
    deployments.data?.filter((d: { serviceName: string }) => d.serviceName === serviceName) ?? [];
  const serviceDeployments = hideCompleted
    ? allServiceDeployments.filter(
        (d: { status: string; conclusion: string | null }) =>
          d.status !== "completed" && d.conclusion !== "success"
      )
    : allServiceDeployments;
  const completedCount = allServiceDeployments.length - serviceDeployments.length;

  if (deployments.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {serviceDeployments.length} deployment{serviceDeployments.length !== 1 ? "s" : ""}
          {hideCompleted && completedCount > 0 && (
            <span className="ml-1 text-xs">({completedCount} hidden)</span>
          )}
        </h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={hideCompleted ? "default" : "outline"}
            onClick={() => setHideCompleted(!hideCompleted)}
            title="Hide completed deployments"
          >
            <Trash2 size={14} className="mr-1" />
            {hideCompleted ? "Show All" : "Hide Completed"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void deployments.refetch()}
            title="Refresh"
          >
            <RotateCcw size={14} className="mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Deployment list */}
      {serviceDeployments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No deployments yet for this service.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {serviceDeployments.map(
            (d: {
              id: string;
              status: string;
              lifecycleStatus?: string;
              statusLabel?: string;
              statusTone?: string;
              conclusion: string | null;
              commitSha: string | null;
              imageTag: string | null;
              createdAt: string;
              canCancel?: boolean;
              canRollback?: boolean;
              steps: { label: string; status: string; detail: string | null }[];
              error?: unknown;
              configSnapshot?: unknown;
            }) => (
              <Card key={d.id} className="overflow-hidden">
                <button
                  className="w-full text-left p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                >
                  <div className="flex items-center gap-3">
                    {expandedId === d.id ? (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{d.id.slice(0, 8)}</span>
                        <Badge
                          variant={getBadgeVariantFromTone(
                            d.statusTone ??
                              getDeploymentTone(d.lifecycleStatus ?? d.status, d.conclusion)
                          )}
                        >
                          {d.statusLabel ?? d.status}
                        </Badge>
                        {d.conclusion && d.conclusion !== d.status && (
                          <Badge variant="outline">{d.conclusion}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {new Date(d.createdAt).toLocaleString()}
                        <span className="flex items-center gap-1">
                          <Timer size={12} />
                          {formatDuration(d.createdAt, d.conclusion ? d.createdAt : null)}
                        </span>
                        {d.commitSha && (
                          <span className="font-mono">@ {d.commitSha.slice(0, 7)}</span>
                        )}
                        {d.imageTag && <span className="font-mono">{d.imageTag}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {d.canCancel && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelMutation.mutate({ deploymentId: d.id });
                        }}
                        title="Cancel"
                      >
                        <XCircle size={14} />
                      </Button>
                    )}
                    {d.canRollback && rollbackTargets.data?.length && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          rollbackMutation.mutate({ serviceId, targetDeploymentId: d.id });
                        }}
                        title="Rollback to this"
                      >
                        <RotateCcw size={14} />
                      </Button>
                    )}
                  </div>
                </button>

                {/* Expanded step details */}
                {expandedId === d.id && (
                  <div className="border-t px-4 py-3 bg-muted/30">
                    {d.error ? (
                      <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                        {typeof d.error === "string" ? d.error : JSON.stringify(d.error)}
                      </div>
                    ) : null}
                    {d.steps && d.steps.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Steps</p>
                        {d.steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <span
                              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${getToneDotClass(
                                getDeploymentStepTone(step.status),
                                { pulse: true }
                              )}`}
                            />
                            <div>
                              <span className="font-medium">{step.label}</span>
                              {step.detail && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {step.detail}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No step details available.</p>
                    )}

                    {d.configSnapshot &&
                    typeof d.configSnapshot === "object" &&
                    Object.keys(d.configSnapshot as Record<string, unknown>).length > 0 ? (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                          <GitCompare size={12} />
                          Config Snapshot
                        </p>
                        <pre className="text-xs bg-background rounded p-2 overflow-x-auto font-mono">
                          {JSON.stringify(d.configSnapshot, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                )}
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
