import chalk from "chalk";
import { printComposeEnvPlan, type ComposeEnvPlanPreview } from "./compose-env-plan-output";

export interface DeploymentPlanPreview {
  isReady: boolean;
  service: {
    name: string;
    projectName: string;
    environmentName: string;
  };
  composeEnvPlan?: ComposeEnvPlanPreview | null;
  target: {
    serverName: string | null;
    imageTag: string | null;
  };
  currentDeployment: {
    statusLabel: string;
    imageTag: string | null;
  } | null;
  preflightChecks: Array<{
    status: "ok" | "warn" | "fail";
    detail: string;
  }>;
  steps: string[];
  executeCommand: string;
}

export function printDeploymentPlan(
  plan: DeploymentPlanPreview,
  options?: { title?: string; subtitle?: string }
): void {
  console.log(chalk.bold(`\n  ${options?.title ?? "Deployment Plan (dry-run)"}\n`));

  if (options?.subtitle) {
    console.log(chalk.dim(`  ${options.subtitle}\n`));
  }

  console.log(`  ${chalk.bold("Service:")}   ${plan.service.name}`);
  console.log(`  ${chalk.bold("Project:")}   ${plan.service.projectName}`);
  console.log(`  ${chalk.bold("Env:")}       ${plan.service.environmentName}`);
  console.log(`  ${chalk.bold("Server:")}    ${plan.target.serverName ?? "unassigned"}`);
  console.log(`  ${chalk.bold("Image:")}     ${plan.target.imageTag ?? "derived at runtime"}`);
  console.log(
    `  ${chalk.bold("Ready:")}     ${plan.isReady ? chalk.green("yes") : chalk.red("no")}`
  );
  console.log();

  if (plan.currentDeployment) {
    console.log(chalk.dim("  Current state:"));
    console.log(chalk.dim(`    Status: ${plan.currentDeployment.statusLabel}`));
    console.log(chalk.dim(`    Image:  ${plan.currentDeployment.imageTag ?? "unknown"}`));
    console.log();
  }

  if (plan.composeEnvPlan) {
    printComposeEnvPlan(plan.composeEnvPlan);
  }

  console.log(`  ${chalk.bold("Planned steps:")}`);
  for (const [index, step] of plan.steps.entries()) {
    console.log(`    ${index + 1}. ${step}`);
  }
  console.log();

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

  console.log(`  To execute: ${chalk.cyan(plan.executeCommand)}\n`);
}
