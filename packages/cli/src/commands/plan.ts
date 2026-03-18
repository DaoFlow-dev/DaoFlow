import { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { printDeploymentPlan } from "../deployment-plan-output";
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

          printDeploymentPlan(plan, { subtitle: "This plan will NOT be executed." });
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
