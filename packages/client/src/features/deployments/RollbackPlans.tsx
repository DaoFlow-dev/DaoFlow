interface RollbackPlan {
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  currentStatus: string;
  currentStatusTone?: string;
  currentStatusLabel?: string;
  isAvailable: boolean;
  planStatusTone?: string;
  planStatusLabel?: string;
  reason: string;
  targetDeploymentId: string;
  targetCommitSha: string;
  targetImageTag: string;
  checks: string[];
  steps: string[];
}

export interface RollbackPlansProps {
  session: { data: unknown };
  deploymentRollbackPlans: { data?: RollbackPlan[] };
  rollbackPlansMessage: string | null;
}

export function RollbackPlans({
  session,
  deploymentRollbackPlans,
  rollbackPlansMessage
}: RollbackPlansProps) {
  return (
    <section className="rollback-plans">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Recovery planning</p>
        <h2>Rollback planning</h2>
      </div>

      {session.data && deploymentRollbackPlans.data ? (
        <div className="rollback-plan-list">
          {deploymentRollbackPlans.data.map((plan) => {
            const planStatusTone =
              plan.planStatusTone ?? plan.currentStatusTone ?? plan.currentStatus;
            const planStatusLabel =
              plan.planStatusLabel ?? plan.currentStatusLabel ?? plan.currentStatus;
            const currentStatusLabel = plan.currentStatusLabel ?? plan.currentStatus;

            return (
              <article
                className="deployment-card"
                data-testid={`rollback-plan-${plan.deploymentId}`}
                key={plan.deploymentId}
              >
                <div className="deployment-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {plan.environmentName} · {plan.projectName}
                    </p>
                    <h3>{plan.serviceName}</h3>
                  </div>
                  <span className={`deployment-status deployment-status--${planStatusTone}`}>
                    {planStatusLabel}
                  </span>
                </div>
                <p className="deployment-card__meta">{plan.reason}</p>
                <p className="deployment-card__meta">Current status: {currentStatusLabel}</p>
                {plan.targetCommitSha ? (
                  <p className="deployment-card__meta">
                    Rollback target: {plan.targetCommitSha} · {plan.targetImageTag}
                  </p>
                ) : null}
                <div className="rollback-plan__columns">
                  <div>
                    <p className="roadmap-item__lane">Preflight checks</p>
                    <ul className="deployment-card__steps">
                      {plan.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="roadmap-item__lane">Recovery steps</p>
                    <ul className="deployment-card__steps">
                      {plan.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="viewer-empty">
          {rollbackPlansMessage ?? "Sign in to inspect rollback targets and recovery checks."}
        </p>
      )}
    </section>
  );
}
