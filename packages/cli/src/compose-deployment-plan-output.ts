import chalk from "chalk";

export interface ComposeDeploymentPlanPreview {
  isReady: boolean;
  deploymentSource: "uploaded-context" | "uploaded-compose";
  project: {
    id: string | null;
    name: string;
    action: "reuse" | "create";
  };
  environment: {
    id: string | null;
    name: string;
    action: "reuse" | "create";
  };
  service: {
    id: string | null;
    name: string;
    action: "reuse" | "create";
    sourceType: "compose";
  };
  target: {
    serverId: string;
    serverName: string;
    serverHost: string;
    composePath: string | null;
    contextPath: string | null;
    requiresContextUpload: boolean;
    localBuildContexts: Array<{
      serviceName: string;
      context: string;
      dockerfile?: string | null;
    }>;
    contextBundle: {
      fileCount: number;
      sizeBytes: number;
      includedOverrides: string[];
    } | null;
  };
  preflightChecks: Array<{
    status: "ok" | "warn" | "fail";
    detail: string;
  }>;
  steps: string[];
  executeCommand: string;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const sizeMb = sizeBytes / 1024 / 1024;
  if (sizeMb < 1) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${sizeMb.toFixed(1)} MB`;
}

function formatScopeAction(action: "reuse" | "create") {
  return action === "reuse" ? chalk.green("reuse") : chalk.yellow("create");
}

export function printComposeDeploymentPlan(
  plan: ComposeDeploymentPlanPreview,
  options?: { title?: string; subtitle?: string }
): void {
  console.log(chalk.bold(`\n  ${options?.title ?? "Compose Deployment Plan (dry-run)"}\n`));

  if (options?.subtitle) {
    console.log(chalk.dim(`  ${options.subtitle}\n`));
  }

  console.log(
    `  ${chalk.bold("Project:")}  ${plan.project.name} (${formatScopeAction(plan.project.action)})`
  );
  console.log(
    `  ${chalk.bold("Env:")}      ${plan.environment.name} (${formatScopeAction(plan.environment.action)})`
  );
  console.log(
    `  ${chalk.bold("Service:")}  ${plan.service.name} (${formatScopeAction(plan.service.action)})`
  );
  console.log(`  ${chalk.bold("Server:")}   ${plan.target.serverName} (${plan.target.serverHost})`);
  console.log(`  ${chalk.bold("Compose:")}  ${plan.target.composePath ?? "<compose-path>"}`);
  console.log(`  ${chalk.bold("Context:")}  ${plan.target.contextPath ?? "."}`);
  console.log(
    `  ${chalk.bold("Upload:")}   ${plan.target.requiresContextUpload ? chalk.yellow("yes") : chalk.green("no")}`
  );
  console.log(
    `  ${chalk.bold("Ready:")}    ${plan.isReady ? chalk.green("yes") : chalk.red("no")}`
  );
  console.log();

  if (plan.target.localBuildContexts.length > 0) {
    console.log(`  ${chalk.bold("Build Contexts:")}`);
    for (const context of plan.target.localBuildContexts) {
      console.log(
        `    ${chalk.cyan(context.serviceName)}  context=${context.context}  dockerfile=${context.dockerfile ?? "Dockerfile"}`
      );
    }
    console.log();
  }

  if (plan.target.contextBundle) {
    console.log(`  ${chalk.bold("Context Bundle:")}`);
    console.log(`    Files:     ${plan.target.contextBundle.fileCount}`);
    console.log(`    Size:      ${formatBytes(plan.target.contextBundle.sizeBytes)}`);
    if (plan.target.contextBundle.includedOverrides.length > 0) {
      console.log(
        `    Overrides: ${chalk.yellow(plan.target.contextBundle.includedOverrides.join(", "))}`
      );
    }
    console.log();
  }

  console.log(`  ${chalk.bold("Pre-flight checks:")}`);
  for (const check of plan.preflightChecks) {
    const icon =
      check.status === "ok"
        ? chalk.green("✓")
        : check.status === "warn"
          ? chalk.yellow("!")
          : chalk.red("✗");
    console.log(`    ${icon} ${check.detail}`);
  }
  console.log();

  console.log(`  ${chalk.bold("Planned steps:")}`);
  for (const [index, step] of plan.steps.entries()) {
    console.log(`    ${index + 1}. ${step}`);
  }
  console.log();

  console.log(`  To execute: ${chalk.cyan(plan.executeCommand)}\n`);
}
