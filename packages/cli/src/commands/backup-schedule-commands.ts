import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { emitBackupDryRunResult, renderBackupError } from "./backup-shared";

export function registerBackupScheduleCommands(backup: Command): void {
  const schedule = backup
    .command("schedule")
    .description("Manage backup cron schedules (Temporal-based)");

  schedule
    .command("enable")
    .description("Enable a cron schedule for a backup policy")
    .requiredOption("--policy <id>", "Backup policy ID")
    .requiredOption("--cron <expression>", 'Cron expression (e.g., "0 */6 * * *")')
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: {
          policy: string;
          cron: string;
          json?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            const policyId = normalizeCliInput(opts.policy, "Policy ID");
            const schedule = normalizeCliInput(opts.cron, "Cron schedule", {
              allowPathTraversal: true,
              allowShellMetacharacters: true,
              maxLength: 256
            });

            if (opts.dryRun) {
              return emitBackupDryRunResult(ctx, {
                dryRun: true,
                action: "backup.schedule.enable",
                policyId,
                schedule,
                message: `Would enable cron schedule "${schedule}" for policy ${policyId}`
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To enable schedule for policy ${policyId}, add --yes`
            );

            try {
              const trpc = createClient();
              const result = await trpc.enableBackupSchedule.mutate({
                policyId,
                schedule
              });

              return ctx.success(result, {
                quiet: () => result.workflowId,
                human: () => {
                  console.log(
                    chalk.green(
                      `✅ Schedule enabled: ${result.schedule} (workflow: ${result.workflowId})`
                    )
                  );
                }
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  schedule
    .command("disable")
    .description("Disable the cron schedule for a backup policy")
    .requiredOption("--policy <id>", "Backup policy ID")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { policy: string; json?: boolean; yes?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          const policyId = normalizeCliInput(opts.policy, "Policy ID");

          ctx.requireConfirmation(
            opts.yes === true,
            `To disable schedule for policy ${policyId}, add --yes`
          );

          try {
            const trpc = createClient();
            const result = await trpc.disableBackupSchedule.mutate({
              policyId
            });

            return ctx.success(result, {
              quiet: () => policyId,
              human: () => {
                console.log(chalk.green("✅ Schedule disabled"));
              }
            });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });
}
