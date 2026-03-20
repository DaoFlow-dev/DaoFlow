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
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  composeFilePath: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  summary: string;
  impactSummary: string;
  desiredImageReference: string;
  actualImageReference: string;
  desiredReplicaCount: number;
  actualReplicaCount: number;
  actualContainerState: string;
  diffs: DriftDiff[];
  recommendedActions: string[];
}

interface ComposeDriftData {
  summary: {
    totalServices: number;
    alignedServices: number;
    reviewRequired: number;
    blockedServices: number;
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
          Planning API
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Compose drift inspector
        </h2>
      </div>

      {session.data && composeDriftReport.data ? (
        <>
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
                Aligned
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.alignedServices}
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
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Blocked
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeDriftReport.data.summary.blockedServices}
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
                  {report.targetServerName} · {report.composeFilePath}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{report.summary}</p>
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
                    <p className="mt-2 text-sm text-muted-foreground">{report.impactSummary}</p>
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
            "Sign in to compare desired Compose specs against the last observed runtime state."}
        </p>
      )}
    </section>
  );
}
