/**
 * cancel.ts — Cancel an in-progress deployment.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   cancel → command lane, deploy:cancel
 */

import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

export function cancelCommand(): Command {
  return new Command("cancel")
    .description("Cancel an in-progress deployment")
    .requiredOption("--deployment <id>", "Deployment ID to cancel")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (opts: { deployment: string; json?: boolean; yes?: boolean }, command: Command) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const deploymentId = normalizeCliInput(opts.deployment, "Deployment ID");

            ctx.requireConfirmation(
              opts.yes === true,
              `Destructive: cancel deployment ${deploymentId}. Pass --yes to confirm.`
            );

            try {
              const trpc = createClient();

              const result = await trpc.cancelDeployment.mutate({
                deploymentId
              });

              return ctx.success(result, {
                quiet: () => deploymentId,
                human: () => {
                  console.log(chalk.blue(`⟳ Cancelling deployment ${deploymentId}...`));
                  console.log(chalk.green(`✓ Deployment ${deploymentId} cancelled`));
                }
              });
            } catch (error) {
              const message = getErrorMessage(error);
              ctx.fail(message, {
                code: message.includes("already") ? "CONFLICT" : "API_ERROR"
              });
            }
          }
        });
      }
    );
}
