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
    <section className="compose-drift">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Planning API</p>
        <h2>Compose drift inspector</h2>
      </div>

      {session.data && composeDriftReport.data ? (
        <>
          <div className="compose-drift-summary" data-testid="compose-drift-summary">
            <div className="token-summary__item">
              <span className="metric__label">Services</span>
              <strong>{composeDriftReport.data.summary.totalServices}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Aligned</span>
              <strong>{composeDriftReport.data.summary.alignedServices}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Review required</span>
              <strong>{composeDriftReport.data.summary.reviewRequired}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Blocked</span>
              <strong>{composeDriftReport.data.summary.blockedServices}</strong>
            </div>
          </div>

          <div className="compose-drift-list">
            {composeDriftReport.data.reports.map((report) => (
              <article
                className="token-card"
                data-testid={`compose-drift-card-${report.composeServiceId}`}
                key={report.composeServiceId}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {report.environmentName} · {report.projectName}
                    </p>
                    <h3>{report.serviceName}</h3>
                  </div>
                  <span className={`deployment-status deployment-status--${report.statusTone}`}>
                    {report.statusLabel}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {report.targetServerName} · {report.composeFilePath}
                </p>
                <p className="deployment-card__meta">{report.summary}</p>
                <p className="deployment-card__meta">
                  Desired image: {report.desiredImageReference} · Actual image:{" "}
                  {report.actualImageReference}
                </p>
                <p className="deployment-card__meta">
                  Desired replicas: {report.desiredReplicaCount} · Actual replicas:{" "}
                  {report.actualReplicaCount} · Runtime: {report.actualContainerState}
                </p>
                {report.diffs.length > 0 ? (
                  <div className="token-card__chips">
                    {report.diffs.map((diff) => (
                      <span className="token-chip" key={diff.id}>
                        {diff.field}: {diff.desiredValue}
                        {" -> "}
                        {diff.actualValue}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="rollback-plan__columns">
                  <div>
                    <h4>Impact</h4>
                    <p className="deployment-card__meta">{report.impactSummary}</p>
                    {report.diffs.length > 0 ? (
                      <ul className="deployment-card__steps">
                        {report.diffs.map((diff) => (
                          <li key={`${diff.id}-impact`}>{diff.impact}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div>
                    <h4>Safe next actions</h4>
                    <ul className="deployment-card__steps">
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
        <p className="viewer-empty">
          {composeDriftMessage ??
            "Sign in to compare desired Compose specs against the last observed runtime state."}
        </p>
      )}
    </section>
  );
}
