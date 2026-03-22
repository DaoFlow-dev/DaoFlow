import { buildComposeEnvPlanDiagnostics } from "../../compose-env-plan";

export type PlanCheckStatus = "ok" | "warn" | "fail";

export interface PlanCheck {
  status: PlanCheckStatus;
  detail: string;
}

export function makePlanCheck(status: PlanCheckStatus, detail: string): PlanCheck {
  return { status, detail };
}

function summarizeComposeEnvPlanDiagnostics(input: {
  branch: string;
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>;
}) {
  const { diagnostics } = input;
  const variableLabel =
    diagnostics.composeEnv.counts.environmentVariables === 1 ? "variable" : "variables";
  const branchScopedLabel =
    diagnostics.matchedBranchOverrideCount === 1 ? "branch-scoped match" : "branch-scoped matches";

  return `Compose env plan resolved ${diagnostics.composeEnv.counts.total} entries for branch ${input.branch}: ${diagnostics.composeEnv.counts.repoDefaults} repo defaults, ${diagnostics.composeEnv.counts.environmentVariables} DaoFlow-managed ${variableLabel}, ${diagnostics.composeEnv.counts.overriddenRepoDefaults} repo-default overrides, ${diagnostics.matchedBranchOverrideCount} ${branchScopedLabel}.`;
}

export function buildComposeEnvPlanChecks(
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>
): PlanCheck[] {
  const checks: PlanCheck[] = [
    makePlanCheck(
      "ok",
      summarizeComposeEnvPlanDiagnostics({ branch: diagnostics.branch, diagnostics })
    )
  ];

  for (const warning of diagnostics.interpolation.warnings) {
    checks.push(makePlanCheck("warn", warning));
  }

  for (const issue of diagnostics.interpolation.unresolved) {
    checks.push(makePlanCheck(issue.severity, issue.detail));
  }

  if (diagnostics.interpolation.status === "ok") {
    checks.push(
      makePlanCheck(
        "ok",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.totalReferences} references with no unresolved variables.`
      )
    );
  } else if (diagnostics.interpolation.status === "warn") {
    checks.push(
      makePlanCheck(
        "warn",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.optionalMissing} unresolved optional references.`
      )
    );
  } else if (diagnostics.interpolation.status === "unavailable") {
    checks.push(
      makePlanCheck(
        "warn",
        "Compose interpolation analysis is unavailable for this plan; only env precedence diagnostics are shown."
      )
    );
  }

  return checks;
}
