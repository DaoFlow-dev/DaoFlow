import chalk from "chalk";

export interface ComposeEnvPlanPreview {
  branch: string;
  matchedBranchOverrideCount: number;
  composeEnv: {
    precedence: string[];
    counts: {
      total: number;
      repoDefaults: number;
      environmentVariables: number;
      runtime: number;
      build: number;
      secrets: number;
      overriddenRepoDefaults: number;
    };
    warnings: string[];
    entries: Array<{
      key: string;
      displayValue: string;
      category: "runtime" | "build" | "default";
      isSecret: boolean;
      source: "inline" | "1password" | "repo-default";
      branchPattern: string | null;
      origin: "repo-default" | "environment-variable";
      overrodeRepoDefault: boolean;
    }>;
  };
  interpolation: {
    status: "ok" | "warn" | "fail" | "unavailable";
    summary: {
      totalReferences: number;
      unresolved: number;
      requiredMissing: number;
      optionalMissing: number;
    };
    warnings: string[];
    unresolved: Array<{
      key: string;
      expression: string;
      severity: "warn" | "fail";
      detail: string;
    }>;
  };
}

function formatInterpolationStatus(status: ComposeEnvPlanPreview["interpolation"]["status"]) {
  if (status === "ok") {
    return chalk.green("ok");
  }

  if (status === "warn" || status === "unavailable") {
    return chalk.yellow(status);
  }

  return chalk.red(status);
}

function formatComposeEnvEntry(entry: ComposeEnvPlanPreview["composeEnv"]["entries"][number]) {
  const metadata = [
    `origin=${entry.origin}`,
    `source=${entry.source}`,
    `category=${entry.category}`
  ];

  if (entry.branchPattern) {
    metadata.push(`branch=${entry.branchPattern}`);
  }
  if (entry.overrodeRepoDefault) {
    metadata.push("overrides=repo-default");
  }

  return `${entry.key}=${entry.displayValue} (${metadata.join(", ")})`;
}

export function printComposeEnvPlan(plan: ComposeEnvPlanPreview): void {
  console.log(`  ${chalk.bold("Compose Env:")}`);
  console.log(`    Branch:       ${plan.branch}`);
  console.log(`    Precedence:   ${plan.composeEnv.precedence.join(" -> ")}`);
  console.log(
    `    Resolved:     ${plan.composeEnv.counts.total} total, ${plan.composeEnv.counts.repoDefaults} repo defaults, ${plan.composeEnv.counts.environmentVariables} DaoFlow-managed, ${plan.matchedBranchOverrideCount} branch-scoped`
  );
  console.log(
    `    Interpolate:  ${formatInterpolationStatus(plan.interpolation.status)} (${plan.interpolation.summary.totalReferences} refs, ${plan.interpolation.summary.unresolved} unresolved)`
  );

  if (plan.composeEnv.warnings.length > 0) {
    console.log(`    Env Warnings:`);
    for (const warning of plan.composeEnv.warnings) {
      console.log(`      ${chalk.yellow("!")} ${warning}`);
    }
  }

  if (plan.interpolation.warnings.length > 0) {
    console.log(`    Plan Warnings:`);
    for (const warning of plan.interpolation.warnings) {
      console.log(`      ${chalk.yellow("!")} ${warning}`);
    }
  }

  if (plan.interpolation.unresolved.length > 0) {
    console.log(`    Unresolved:`);
    for (const issue of plan.interpolation.unresolved) {
      const icon = issue.severity === "fail" ? chalk.red("✗") : chalk.yellow("!");
      console.log(`      ${icon} ${issue.detail}`);
    }
  }

  if (plan.composeEnv.entries.length > 0) {
    console.log(`    Entries:`);
    for (const entry of plan.composeEnv.entries) {
      console.log(`      ${formatComposeEnvEntry(entry)}`);
    }
  }

  console.log();
}
