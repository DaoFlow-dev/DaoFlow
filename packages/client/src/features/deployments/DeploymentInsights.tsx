import { Badge } from "@/components/ui/badge";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface EvidenceItem {
  kind: string;
  id: string;
  title: string;
  detail: string;
}

interface InsightItem {
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  status: string;
  statusTone: string;
  statusLabel: string;
  summary: string;
  suspectedRootCause: string;
  safeActions: string[];
  evidence: EvidenceItem[];
  healthyBaseline: {
    deploymentId: string;
    commitSha: string;
    imageTag: string;
    finishedAt: string | null;
  } | null;
}

export interface DeploymentInsightsProps {
  session: { data: unknown };
  deploymentInsights: { data?: InsightItem[] };
  insightsMessage: string | null;
}

export function DeploymentInsights({
  session,
  deploymentInsights,
  insightsMessage
}: DeploymentInsightsProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agentic observability
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Agent-ready deployment diagnostics
        </h2>
      </div>

      {session.data && deploymentInsights.data ? (
        <div className="grid grid-cols-2 gap-3">
          {deploymentInsights.data.map((insight) => (
            <article
              className="rounded-xl border bg-card p-5 shadow-sm"
              data-testid={`deployment-insight-${insight.deploymentId}`}
              key={insight.deploymentId}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {insight.environmentName} · {insight.projectName}
                  </p>
                  <h3 className="text-base font-semibold text-foreground">{insight.serviceName}</h3>
                </div>
                <Badge variant={getBadgeVariantFromTone(insight.statusTone)}>
                  {insight.statusLabel}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{insight.summary}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Suspected root cause: {insight.suspectedRootCause}
              </p>
              {insight.healthyBaseline ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Healthy baseline: {insight.healthyBaseline.commitSha} ·{" "}
                  {insight.healthyBaseline.imageTag}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {insight.evidence.map((item) => (
                  <Badge variant="outline" key={item.id}>
                    {item.kind}:{item.title}
                  </Badge>
                ))}
              </div>
              <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {insight.safeActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {insightsMessage ?? "Sign in to inspect evidence-backed deployment diagnostics."}
        </p>
      )}
    </section>
  );
}
