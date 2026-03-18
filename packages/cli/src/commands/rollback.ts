import { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function rollbackCommand(): Command {
  return new Command("rollback")
    .description("Rollback a service to a previous successful deployment")
    .requiredOption("--service <id>", "Service ID to rollback")
    .option("--target <deployment-id>", "Target deployment ID to rollback to")
    .option("--to <deployment-id>", "Alias for --target")
    .option("--dry-run", "Show rollback plan without executing")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          service: string;
          target?: string;
          to?: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        const trpc = createClient();
        const isJson = resolveCommandJsonOption(command, opts.json);

        try {
          const targetRef = opts.target ?? opts.to;

          // Fetch available rollback targets for this service
          const targets = await trpc.rollbackTargets.query({ serviceId: opts.service });

          if (!targets.length) {
            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: true,
                  data: { targets: [], message: "No rollback targets available" }
                })
              );
            } else {
              console.log(chalk.yellow("No rollback targets available for this service."));
            }
            return;
          }

          // If no target specified, list available targets
          if (!targetRef) {
            if (isJson) {
              emitJsonSuccess({ targets });
            } else {
              console.log(chalk.bold("\n  Available Rollback Targets\n"));
              for (const t of targets) {
                console.log(
                  `  ${chalk.green("✓")} ${t.deploymentId.slice(0, 8)}  ${t.serviceName.padEnd(20)} ${t.imageTag ?? "—"}  ${chalk.dim(t.concludedAt?.slice(0, 10) ?? "")}`
                );
              }
              console.log(
                chalk.dim(
                  `\n  Usage: daoflow rollback --service ${opts.service} --target <deployment-id> --yes\n`
                )
              );
            }
            return;
          }

          const target = targets.find((t) => t.deploymentId.startsWith(targetRef));
          if (!target) {
            if (isJson) {
              console.log(
                JSON.stringify({
                  ok: false,
                  error: `Deployment ${targetRef} not found in rollback targets`,
                  code: "NOT_FOUND"
                })
              );
            } else {
              console.error(chalk.red(`✗ Deployment ${targetRef} not found in rollback targets`));
            }
            process.exit(1);
          }

          if (opts.dryRun) {
            const plan = await trpc.rollbackPlan.query({
              service: opts.service,
              target: target.deploymentId
            });

            if (isJson) {
              emitJsonSuccess({ dryRun: true, plan });
            } else {
              console.log(chalk.bold("\n  Rollback Plan (dry-run)\n"));
              console.log(`  Service: ${plan.service.name}`);
              console.log(`  Project: ${plan.service.projectName}`);
              console.log(`  Env:     ${plan.service.environmentName}`);
              console.log(`  Target:  ${plan.targetDeployment?.id ?? "—"}`);
              console.log(`  Image:   ${plan.targetDeployment?.imageTag ?? "—"}`);
              console.log(`  Commit:  ${plan.targetDeployment?.commitSha ?? "—"}`);
              console.log();
              if (plan.currentDeployment) {
                console.log(chalk.dim("  Current deployment:"));
                console.log(
                  `    ${plan.currentDeployment.id}  ${plan.currentDeployment.statusLabel}`
                );
                console.log();
              }
              console.log(chalk.dim("  Preflight checks:"));
              plan.preflightChecks.forEach((check) => {
                const marker =
                  check.status === "ok"
                    ? chalk.green("✓")
                    : check.status === "warn"
                      ? chalk.yellow("!")
                      : chalk.red("✗");
                console.log(`    ${marker} ${check.detail}`);
              });
              console.log();
              console.log(chalk.dim("  Steps:"));
              plan.steps.forEach((step, i) => {
                console.log(`    ${chalk.green(`${i + 1}.`)} ${step}`);
              });
            }
            process.exit(3);
          }

          if (!opts.yes) {
            const error =
              "Destructive operation. Pass --yes to confirm, or use --dry-run to preview.";
            if (isJson) {
              emitJsonError(error, "CONFIRMATION_REQUIRED");
            } else {
              console.error(chalk.yellow(error));
            }
            process.exit(1);
            return;
          }

          if (!isJson) {
            console.log(chalk.blue(`⟳ Rolling back to ${target.deploymentId.slice(0, 8)}...`));
          }

          const result = await trpc.executeRollback.mutate({
            serviceId: opts.service,
            targetDeploymentId: target.deploymentId
          });

          if (isJson) {
            emitJsonSuccess(result);
          } else {
            console.log(chalk.green("✓ Rollback deployment queued"));
            console.log(chalk.dim(`  ID: ${result.id}`));
            console.log(chalk.dim(`  Service: ${result.serviceName}`));
          }
        } catch (err) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "API_ERROR");
          } else {
            console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
          }
          process.exit(1);
        }
      }
    );
}
