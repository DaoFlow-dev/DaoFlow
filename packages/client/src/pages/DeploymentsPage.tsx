import { Fragment, memo, useCallback, useState } from "react";
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
import {
  Rocket,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  RefreshCw,
  XCircle,
  Search
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import DeploymentLogViewer from "@/components/DeploymentLogViewer";
import DeploymentRollbackDialog from "@/components/DeploymentRollbackDialog";
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
  const [cancelingDeploymentId, setCancelingDeploymentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const recentDeployments = trpc.recentDeployments.useQuery(
    { limit: 50 },
    { enabled: Boolean(session.data) }
  );

  const cancelMut = trpc.cancelDeployment.useMutation({
    onSuccess: () => void recentDeployments.refetch(),
    onSettled: () => setCancelingDeploymentId(null)
  });

  const deployments = recentDeployments.data ?? [];

  const filteredDeployments = deployments.filter((d) => {
    const matchesSearch = searchQuery
      ? String(d.serviceName ?? d.projectId ?? "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      : true;
    const matchesStatus =
      statusFilter === "all"
        ? true
        : String(d.statusLabel).toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesStatus;
  });

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleOpenRollback = useCallback((serviceId: string) => {
    setRollbackServiceId(serviceId);
  }, []);

  const { mutate: cancelDeployment } = cancelMut;

  const handleCancelDeployment = useCallback(
    (deploymentId: string) => {
      if (window.confirm("Cancel this deployment?")) {
        setCancelingDeploymentId(deploymentId);
        cancelDeployment({ deploymentId });
      }
    },
    [cancelDeployment]
  );

  return (
    <main className="shell space-y-6" data-testid="deployments-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          View deployment history, logs, and rollback options.
        </p>
      </div>

      {/* Search + Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search by service name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="healthy">Healthy</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Deployment History</CardTitle>
          <CardDescription>
            {filteredDeployments.length} of {deployments.length} deployment
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
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
                <Rocket size={28} className="text-primary/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No deployments yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Queue your first deployment to get started.
                </p>
              </div>
            </div>
          ) : filteredDeployments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">No deployments match your filters.</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </Button>
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
                {filteredDeployments.map((d) => {
                  const id = String(d.id);
                  return (
                    <DeploymentRow
                      key={id}
                      deployment={d as DeploymentRowData}
                      isExpanded={expandedId === id}
                      cancelPending={cancelingDeploymentId === id}
                      onToggleExpand={handleToggleExpand}
                      onOpenRollback={handleOpenRollback}
                      onCancelDeployment={handleCancelDeployment}
                    />
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

interface DeploymentStepData {
  id: string | number;
  label: string;
  status?: string | null;
  detail?: string | null;
}

interface DeploymentRowData {
  id: string | number;
  serviceId?: string | null;
  serviceName?: string | null;
  projectId?: string | null;
  environmentName?: string | null;
  targetServerName?: string | null;
  statusTone: string;
  statusLabel: string;
  lifecycleStatus?: string | null;
  status?: string | null;
  sourceType?: string | null;
  createdAt?: string | Date | null;
  canRollback?: boolean;
  conclusion?: string | null;
  requestedByEmail?: string | null;
  commitSha?: string | null;
  imageTag?: string | null;
  steps?: DeploymentStepData[];
}

interface DeploymentRowProps {
  deployment: DeploymentRowData;
  isExpanded: boolean;
  cancelPending: boolean;
  onToggleExpand: (deploymentId: string) => void;
  onOpenRollback: (serviceId: string) => void;
  onCancelDeployment: (deploymentId: string) => void;
}

export const DeploymentRow = memo(function DeploymentRow({
  deployment,
  isExpanded,
  cancelPending,
  onToggleExpand,
  onOpenRollback,
  onCancelDeployment
}: DeploymentRowProps) {
  const id = String(deployment.id);
  const lifecycleStatus =
    typeof deployment.lifecycleStatus === "string"
      ? deployment.lifecycleStatus
      : String(deployment.status);
  const isSuccessful = deployment.canRollback === true && typeof deployment.serviceId === "string";
  const actorLabel =
    typeof deployment.requestedByEmail === "string" && deployment.requestedByEmail.length > 0
      ? deployment.requestedByEmail
      : "system";

  return (
    <Fragment>
      <TableRow
        className="cursor-pointer transition-colors hover:bg-muted/40"
        onClick={() => onToggleExpand(id)}
      >
        <TableCell className="px-2">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </TableCell>
        <TableCell className="font-medium">
          {String(deployment.serviceName ?? deployment.projectId ?? "—")}
          <div className="text-xs font-normal text-muted-foreground">
            {String(deployment.environmentName ?? "unknown environment")} on{" "}
            {String(deployment.targetServerName ?? "unknown server")}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant={getBadgeVariantFromTone(String(deployment.statusTone))}>
              {String(deployment.statusLabel)}
            </Badge>
            <span className="text-xs text-muted-foreground">Lifecycle: {lifecycleStatus}</span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {String(deployment.sourceType ?? "docker")}
        </TableCell>
        <TableCell
          className="text-muted-foreground"
          title={deployment.createdAt ? new Date(deployment.createdAt).toLocaleString() : undefined}
        >
          {formatRelative(deployment.createdAt ?? null)}
        </TableCell>
        <TableCell className="text-right">
          {isSuccessful && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Rollback deployment"
              onClick={(e) => {
                e.stopPropagation();
                onOpenRollback(String(deployment.serviceId));
              }}
            >
              <RotateCcw size={14} className="mr-1" />
              Rollback
            </Button>
          )}
          {typeof deployment.conclusion === "string" && deployment.conclusion === "failure" && (
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
          {(lifecycleStatus === "queued" || lifecycleStatus === "running") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              aria-label="Cancel deployment"
              disabled={cancelPending}
              onClick={(e) => {
                e.stopPropagation();
                onCancelDeployment(id);
              }}
            >
              <XCircle size={14} className="mr-1" />
              Cancel
            </Button>
          )}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={6} className="p-0">
            <div className="space-y-4 bg-muted/10 p-5 backdrop-blur-sm">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Actor
                  </p>
                  <p className="text-sm font-medium">{actorLabel}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Commit
                  </p>
                  <p className="text-sm font-medium">{String(deployment.commitSha ?? "—")}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Image
                  </p>
                  <p className="truncate text-sm font-medium">
                    {String(deployment.imageTag ?? "—")}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Outcome
                  </p>
                  <p className="text-sm font-medium">
                    {typeof deployment.conclusion === "string" ? deployment.conclusion : "pending"}
                  </p>
                </div>
              </div>
              {Array.isArray(deployment.steps) && deployment.steps.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Structured steps
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {deployment.steps.map((step) => (
                      <div
                        key={String(step.id)}
                        className="rounded-lg border border-border/50 bg-background p-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{String(step.label)}</p>
                          <Badge variant="outline">
                            {typeof step.status === "string" ? step.status : "pending"}
                          </Badge>
                        </div>
                        {typeof step.detail === "string" && step.detail.length > 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
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
});

DeploymentRow.displayName = "DeploymentRow";
