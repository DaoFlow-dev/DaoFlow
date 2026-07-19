import { ChartNoAxesCombined, Unplug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import {
  LatestMetricsGrid,
  MetricsHistoryTable,
  MetricsPolicyForm
} from "./ServerMetricsPanelParts";
import {
  formatAge,
  formatPercent,
  type MetricPolicy,
  type MetricReport,
  type MetricStatus
} from "./ServerMetricsPanelModel";

const statusDetails: Record<
  MetricStatus,
  { label: string; variant: "success" | "secondary" | "destructive" | "outline" }
> = {
  healthy: { label: "Healthy", variant: "success" },
  warning: { label: "Warning", variant: "secondary" },
  hard: { label: "Hard threshold", variant: "destructive" },
  unreachable: { label: "Unreachable", variant: "destructive" }
};

export interface ServerMetricsPanelProps {
  serverId: string;
  canManage: boolean;
  onSaved?: () => Promise<void> | void;
}

export function ServerMetricsPanel({ serverId, canManage, onSaved }: ServerMetricsPanelProps) {
  const session = useSession();
  const metrics = trpc.serverMetricMonitoring.useQuery(
    { serverId, limit: 60, since: "24h" },
    { enabled: Boolean(session.data && serverId) }
  );
  const configurePolicy = trpc.configureServerMetricPolicy.useMutation();
  const report = metrics.data as MetricReport | undefined;
  const status = report?.state.status ?? "healthy";
  const statusDetail = statusDetails[status];

  async function savePolicy(policy: MetricPolicy) {
    const updatedPolicy = await configurePolicy.mutateAsync({
      serverId,
      ...policy
    });
    await metrics.refetch();
    await onSaved?.();
    return updatedPolicy;
  }

  if (metrics.isLoading) {
    return (
      <Card data-testid={`server-metrics-panel-${serverId}`}>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading persistent metrics…
        </CardContent>
      </Card>
    );
  }

  if (metrics.isError || !report) {
    return (
      <Card data-testid={`server-metrics-panel-${serverId}`}>
        <CardContent className="p-6">
          <p
            className="text-sm text-destructive"
            role="alert"
            data-testid={`server-metrics-error-${serverId}`}
          >
            {metrics.error instanceof Error
              ? metrics.error.message
              : "Persistent metrics are unavailable."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const latest = report.latest;
  return (
    <div className="flex flex-col gap-4" data-testid={`server-metrics-panel-${serverId}`}>
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle
                className="flex items-center gap-2 text-base"
                data-testid={`server-metrics-title-${serverId}`}
              >
                <ChartNoAxesCombined data-icon="inline-start" /> Persistent server metrics
              </CardTitle>
              <CardDescription>
                Stored samples from the last 24 hours, with no automatic remediation.
              </CardDescription>
            </div>
            <Badge variant={statusDetail.variant} data-testid={`server-metrics-status-${serverId}`}>
              {statusDetail.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status === "unreachable" ? (
            <Alert variant="destructive" data-testid={`server-metrics-unreachable-${serverId}`}>
              <Unplug />
              <AlertTitle>Metrics source unreachable</AlertTitle>
              <AlertDescription>
                {report.state.error ?? "The latest metrics could not be collected."} DaoFlow does
                not automatically remediate unreachable servers.
              </AlertDescription>
            </Alert>
          ) : (report.state.activeMetrics?.length ?? 0) > 0 ? (
            <ul
              className="space-y-1 text-sm text-muted-foreground"
              data-testid={`server-metrics-state-details-${serverId}`}
            >
              {report.state.activeMetrics?.map((metric) => (
                <li key={metric.metric}>
                  {metric.metric}: {formatPercent(metric.measuredValue)}
                  {metric.threshold != null
                    ? ` (${metric.status} threshold ${formatPercent(metric.threshold)})`
                    : ""}
                </li>
              ))}
            </ul>
          ) : report.state.metric && report.state.measuredValue != null ? (
            <p className="text-sm text-muted-foreground">
              {report.state.metric}: {formatPercent(report.state.measuredValue)}
            </p>
          ) : null}
          <div
            className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
            data-testid={`server-metrics-sample-meta-${serverId}`}
          >
            <span data-testid={`server-metrics-sample-age-${serverId}`}>
              Sample age: {formatAge(latest?.collectedAt)}
            </span>
            <span data-testid={`server-metrics-sample-count-${serverId}`}>
              {report.history.length} samples in 24h
            </span>
          </div>
          <LatestMetricsGrid serverId={serverId} latest={latest} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent history</CardTitle>
          <CardDescription>Newest samples appear first.</CardDescription>
        </CardHeader>
        <CardContent>
          <MetricsHistoryTable serverId={serverId} history={report.history} />
        </CardContent>
      </Card>

      <MetricsPolicyForm
        serverId={serverId}
        policy={report.policy}
        canManage={canManage}
        isPending={configurePolicy.isPending}
        onSave={savePolicy}
      />
    </div>
  );
}
