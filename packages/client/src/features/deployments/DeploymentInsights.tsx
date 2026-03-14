import { getInventoryTone } from "../../lib/tone-utils";

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
    <section className="deployment-insights">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Agentic observability</p>
        <h2>Agent-ready deployment diagnostics</h2>
      </div>

      {session.data && deploymentInsights.data ? (
        <div className="insight-list">
          {deploymentInsights.data.map((insight) => (
            <article
              className="timeline-event"
              data-testid={`deployment-insight-${insight.deploymentId}`}
              key={insight.deploymentId}
            >
              <div className="timeline-event__top">
                <div>
                  <p className="roadmap-item__lane">
                    {insight.environmentName} · {insight.projectName}
                  </p>
                  <h3>{insight.serviceName}</h3>
                </div>
                <span
                  className={`deployment-status deployment-status--${getInventoryTone(insight.status)}`}
                >
                  {insight.status}
                </span>
              </div>
              <p className="deployment-card__meta">{insight.summary}</p>
              <p className="deployment-card__meta">
                Suspected root cause: {insight.suspectedRootCause}
              </p>
              {insight.healthyBaseline ? (
                <p className="deployment-card__meta">
                  Healthy baseline: {insight.healthyBaseline.commitSha} ·{" "}
                  {insight.healthyBaseline.imageTag}
                </p>
              ) : null}
              <div className="token-card__chips">
                {insight.evidence.map((item) => (
                  <span className="token-chip" key={item.id}>
                    {item.kind}:{item.title}
                  </span>
                ))}
              </div>
              <ul className="deployment-card__steps">
                {insight.safeActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <p className="viewer-empty">
          {insightsMessage ?? "Sign in to inspect evidence-backed deployment diagnostics."}
        </p>
      )}
    </section>
  );
}
