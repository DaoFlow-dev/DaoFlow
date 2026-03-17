/**
 * cancel.ts — Cancel an in-progress deployment.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   cancel → command lane, deploy:cancel
 */

import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function cancelCommand(): Command {
  return new Command("cancel")
    .description("Cancel an in-progress deployment")
    .requiredOption("--deployment <id>", "Deployment ID to cancel")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: { deployment: string; json?: boolean; yes?: boolean }) => {
      if (!opts.yes && !opts.json) {
        console.error(
          chalk.yellow(`Destructive: cancel deployment ${opts.deployment}. Pass --yes to confirm.`)
        );
        process.exit(1);
      }

      try {
        const trpc = createClient();

        if (!opts.json) {
          console.log(chalk.blue(`⟳ Cancelling deployment ${opts.deployment}...`));
        }

        const result = await trpc.cancelDeployment.mutate({
          deploymentId: opts.deployment
        });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, ...result }));
        } else {
          console.log(chalk.green(`✓ Deployment ${opts.deployment} cancelled`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const isConflict = message.includes("already");

        if (opts.json) {
          console.log(
            JSON.stringify({
              ok: false,
              error: message,
              code: isConflict ? "CONFLICT" : "API_ERROR"
            })
          );
        } else {
          console.error(chalk.red(`✗ ${message}`));
        }
        process.exit(isConflict ? 1 : 1);
      }
    });
}
