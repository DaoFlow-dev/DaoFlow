/**
 * cancel.ts — Cancel an in-progress deployment.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   cancel → command lane, deploy:cancel
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";

export function cancelCommand(): Command {
  return new Command("cancel")
    .description("Cancel an in-progress deployment")
    .requiredOption("--deployment <id>", "Deployment ID to cancel")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (opts: { deployment: string; json?: boolean; yes?: boolean }, command: Command) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (!opts.yes) {
          const error = `Destructive: cancel deployment ${opts.deployment}. Pass --yes to confirm.`;
          if (isJson) {
            emitJsonError(error, "CONFIRMATION_REQUIRED");
          } else {
            console.error(chalk.yellow(error));
          }
          process.exit(1);
          return;
        }

        try {
          const trpc = createClient();

          if (!isJson) {
            console.log(chalk.blue(`⟳ Cancelling deployment ${opts.deployment}...`));
          }

          const result = await trpc.cancelDeployment.mutate({
            deploymentId: opts.deployment
          });

          if (isJson) {
            emitJsonSuccess(result);
          } else {
            console.log(chalk.green(`✓ Deployment ${opts.deployment} cancelled`));
          }
        } catch (err) {
          const message = getErrorMessage(err);
          const isConflict = message.includes("already");

          if (isJson) {
            emitJsonError(message, isConflict ? "CONFLICT" : "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${message}`));
          }
          process.exit(isConflict ? 1 : 1);
        }
      }
    );
}
