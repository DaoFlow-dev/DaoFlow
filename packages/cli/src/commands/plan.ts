import { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function planCommand(): Command {
  return new Command("plan")
    .description("Preview a deployment plan without executing it")
    .requiredOption("--service <id>", "Service name or ID")
    .option("--server <id>", "Target server")
    .option("--image <tag>", "Image tag to deploy")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { service: string; server?: string; image?: string; json?: boolean },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        try {
          const trpc = createClient();
          const plan = await trpc.deploymentPlan.query({
            service: opts.service,
            server: opts.server,
            image: opts.image
          });

          if (isJson) {
            emitJsonSuccess(plan);
            return;
          }

          console.log(chalk.bold("\n  Deployment Plan (dry-run)\n"));
          console.log(chalk.dim("  This plan will NOT be executed.\n"));
          console.log(`  ${chalk.bold("Service:")}   ${plan.service.name}`);
          console.log(`  ${chalk.bold("Project:")}   ${plan.service.projectName}`);
          console.log(`  ${chalk.bold("Env:")}       ${plan.service.environmentName}`);
          console.log(`  ${chalk.bold("Server:")}    ${plan.target.serverName ?? "unassigned"}`);
          console.log(
            `  ${chalk.bold("Image:")}     ${plan.target.imageTag ?? "derived at runtime"}`
          );
          console.log(
            `  ${chalk.bold("Ready:")}     ${plan.isReady ? chalk.green("yes") : chalk.red("no")}`
          );
          console.log();

          if (plan.currentDeployment) {
            console.log(chalk.dim(`  Current state:`));
            console.log(chalk.dim(`    Status: ${plan.currentDeployment.statusLabel}`));
            console.log(chalk.dim(`    Image:  ${plan.currentDeployment.imageTag ?? "unknown"}`));
            console.log();
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
        } catch (error) {
          if (isJson) {
            emitJsonError(getErrorMessage(error), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
          }
          process.exit(1);
        }
      }
    );
}
