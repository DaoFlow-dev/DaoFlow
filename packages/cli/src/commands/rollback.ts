import { Command } from "commander";
import chalk from "chalk";
import { ApiClient } from "../api-client";

export function rollbackCommand(): Command {
  return new Command("rollback")
    .description("Rollback to a specific deployment")
    .argument("[deployment-id]", "Target deployment ID to rollback to")
    .option("--service <name>", "Service name")
    .option("--dry-run", "Show rollback plan without executing")
    .action(async (deploymentId, opts) => {
      const api = new ApiClient();

      // Fetch rollback plans
      const data = await api.get<
        Array<{
          deploymentId: string;
          serviceName: string;
          targetCommitSha: string;
          targetImageTag: string;
          isAvailable: boolean;
          reason: string;
          steps: string[];
        }>
      >("/trpc/listDeploymentRollbackPlans");

      if (!data.length) {
        console.log(chalk.yellow("No rollback targets available."));
        return;
      }

      if (!deploymentId) {
        console.log(chalk.bold("\n  Available Rollback Targets\n"));
        for (const plan of data) {
          const available = plan.isAvailable ? chalk.green("✓") : chalk.red("✗");
          console.log(
            `  ${available} ${plan.deploymentId.slice(0, 8)}  ${plan.serviceName.padEnd(20)} ${plan.targetImageTag ?? "—"}`
          );
        }
        console.log(chalk.dim("\n  Usage: daoflow rollback <deployment-id>\n"));
        return;
      }

      const target = data.find((p) => p.deploymentId.startsWith(deploymentId));
      if (!target) {
        console.error(chalk.red(`✗ Deployment ${deploymentId} not found`));
        process.exit(1);
      }

      if (opts.dryRun) {
        console.log(chalk.bold("\n  Rollback Plan (dry-run)\n"));
        console.log(`  Target: ${target.deploymentId}`);
        console.log(`  Image:  ${target.targetImageTag}`);
        console.log(`  Commit: ${target.targetCommitSha}`);
        console.log();
        console.log(chalk.dim("  Steps:"));
        target.steps.forEach((step, i) => {
          console.log(`    ${chalk.green(`${i + 1}.`)} ${step}`);
        });
        return;
      }

      console.log(chalk.blue(`⟳ Rolling back to ${target.deploymentId.slice(0, 8)}...`));

      const result = await api.post("/trpc/createDeployment", {
        serviceName: target.serviceName,
        sourceType: "image",
        imageTag: target.targetImageTag,
        commitSha: target.targetCommitSha,
        environmentName: "production",
        projectName: "default",
        targetServerId: ""
      });

      console.log(chalk.green(`✓ Rollback deployment queued`));
      console.log(chalk.dim(JSON.stringify(result, null, 2)));
    });
}
