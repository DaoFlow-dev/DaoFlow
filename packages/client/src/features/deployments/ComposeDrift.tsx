import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface DriftDiff {
  id: string;
  field: string;
  desiredValue: string;
  actualValue: string;
  impact: string;
}

interface DriftReport {
  composeServiceId: string;
  environmentId: string;
  projectName: string;
  projectId: string;
  environmentName: string;
  serviceName: string;
  composeFilePath: string | null;
  target: {
    serverId: string | null;
    serverName: string | null;
    composeProjectName: string | null;
  };
  source: "cached-snapshot" | "unavailable";
  authoritative: false;
  attemptedAt: string | null;
  observedAt: string | null;
  maxAgeSeconds: number;
  evidenceRefs: string[];
  status: string;
  statusLabel: string;
  statusTone: string;
  summary: string;
  impactSummary: string | null;
  desiredImageReference: string | null;
  actualImageReference: string | null;
  desiredReplicaCount: number | null;
  actualReplicaCount: number | null;
  actualContainerState: string | null;
  diffs: DriftDiff[];
  recommendedActions: string[];
}

interface ComposeDriftData {
  summary: {
    totalServices: number;
    cachedSnapshotServices: number;
    unavailableServices: number;
    reviewRequired: number;
    blockedServices: number;
  };
  inspection: {
    availability: "not-implemented";
    blockers: string[];
    limits: { minimumIntervalSeconds: number; maxConcurrentPerServer: number };
  };
  reports: DriftReport[];
}

export interface ComposeDriftProps {
  session: { data: unknown };
  composeDriftReport: { data?: ComposeDriftData };
  composeDriftMessage: string | null;
}

export function ComposeDrift({
  session,
  composeDriftReport,
  composeDriftMessage
}: ComposeDriftProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Read API · containment mode
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Compose drift snapshots
        </h2>
      </div>

      {session.data && composeDriftReport.data ? (
        <>
          <p
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground"
            data-testid="compose-drift-containment-notice"
          >
            Live inspection is not implemented. Every result below is non-authoritative; no result
            confirms current runtime alignment.
          </p>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="compose-drift-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Services
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.totalServices}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Cached snapshots
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.cachedSnapshotServices}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                No snapshot
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.unavailableServices}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Review required
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.reviewRequired}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {composeDriftReport.data.reports.map((report) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`compose-drift-card-${report.composeServiceId}`}
                key={report.composeServiceId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {report.environmentName} · {report.projectName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {report.serviceName}
                    </h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(report.statusTone)}>
                    {report.statusLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {report.target.serverName ?? "Unknown server"} ·{" "}
                  {report.composeFilePath ?? "Unknown Compose file"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{report.summary}</p>
                <p
                  className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300"
                  data-testid={`compose-drift-authority-${report.composeServiceId}`}
                >
                  Source: {report.source} · Authoritative: no
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Observed: {report.observedAt ?? "—"} · Attempted: {report.attemptedAt ?? "—"} ·
                  Max age: {report.maxAgeSeconds}s
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Desired image: {report.desiredImageReference} · Actual image:{" "}
                  {report.actualImageReference}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Desired replicas: {report.desiredReplicaCount} · Actual replicas:{" "}
                  {report.actualReplicaCount} · Runtime: {report.actualContainerState}
                </p>
                {report.diffs.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {report.diffs.map((diff) => (
                      <Badge variant="outline" key={diff.id}>
                        {diff.field}: {diff.desiredValue}
                        {" -> "}
                        {diff.actualValue}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Impact</h4>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {report.impactSummary ?? "No impact assessment is available."}
                    </p>
                    {report.diffs.length > 0 ? (
                      <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {report.diffs.map((diff) => (
                          <li key={`${diff.id}-impact`}>{diff.impact}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Safe next actions</h4>
                    <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {report.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {composeDriftMessage ??
            "Sign in to review non-authoritative cached Compose drift snapshots."}
        </p>
      )}
    </section>
  );
}
