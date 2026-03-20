import { Badge } from "@/components/ui/badge";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface RollbackPlan {
  deploymentId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  currentStatus: string;
  currentStatusTone: string;
  currentStatusLabel: string;
  isAvailable: boolean;
  planStatusTone: string;
  planStatusLabel: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recovery planning
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Rollback planning</h2>
      </div>

      {session.data && deploymentRollbackPlans.data ? (
        <div className="grid grid-cols-2 gap-3">
          {deploymentRollbackPlans.data.map((plan) => {
            return (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`rollback-plan-${plan.deploymentId}`}
                key={plan.deploymentId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {plan.environmentName} · {plan.projectName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{plan.serviceName}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(plan.planStatusTone)}>
                    {plan.planStatusLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{plan.reason}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Current status: {plan.currentStatusLabel}
                </p>
                {plan.targetCommitSha ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Rollback target: {plan.targetCommitSha} · {plan.targetImageTag}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Preflight checks
                    </p>
                    <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                      {plan.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Recovery steps
                    </p>
                    <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
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
        <p className="py-10 text-center text-sm text-muted-foreground">
          {rollbackPlansMessage ?? "Sign in to inspect rollback targets and recovery checks."}
        </p>
      )}
    </section>
  );
}
