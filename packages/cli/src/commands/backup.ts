/**
 * backup.ts — CLI commands for backup management.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   backup list  → read lane, backup:read
 *   backup run   → command lane, backup:run
 *   backup restore → command lane, backup:restore
 *
 * T-33, T-34, T-35: Backup CLI commands
 */

import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getErrorMessage, normalizeCliInput } from "../command-helpers";
import type { BackupRestorePlanOutput, QueueRestoreOutput } from "../trpc-contract";
import { createClient } from "../trpc-client";
import { buildBackupDownloadInfo, renderBackupDownloadInfo } from "./backup-download";
import { registerBackupDestinationCommands } from "./backup-destination-commands";
import { registerBackupPolicySubcommands } from "./backup-policy";
import { registerBackupScheduleCommands } from "./backup-schedule-commands";
import {
  emitBackupDryRunResult,
  renderBackupError,
  renderBackupRestorePlan
} from "./backup-shared";

type BackupRestoreDryRunResult = {
  dryRun: true;
  plan: BackupRestorePlanOutput;
};

type BackupRestoreCommandResult = BackupRestoreDryRunResult | QueueRestoreOutput;

export function backupCommand(): Command {
  const backup = new Command("backup").description("Manage backup policies and runs");
  registerBackupPolicySubcommands(backup);
  registerBackupDestinationCommands(backup);
  registerBackupScheduleCommands(backup);

  backup
    .command("list")
    .description("List backup policies and recent runs")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max runs to show", "12")
    .action(async (opts: { json?: boolean; limit: string }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          try {
            const trpc = createClient();
            const data = await trpc.backupOverview.query({ limit: Number(opts.limit) });

            return ctx.success(data, {
              human: () => {
                console.log(chalk.bold("\n📦 Backup Overview\n"));
                console.log(`  Policies:  ${data.summary.totalPolicies}`);
                console.log(`  Queued:    ${data.summary.queuedRuns}`);
                console.log(`  Running:   ${data.summary.runningRuns}`);
                console.log(`  Succeeded: ${chalk.green(data.summary.succeededRuns)}`);
                console.log(`  Failed:    ${chalk.red(data.summary.failedRuns)}`);

                if (data.policies.length > 0) {
                  console.log(chalk.bold("\n  Policies:"));
                  for (const policy of data.policies) {
                    console.log(
                      `    ${chalk.dim(policy.id)}  ${policy.projectName}/${policy.serviceName}  ${policy.targetType}  schedule=${policy.scheduleLabel}  retain=${policy.retentionCount}`
                    );
                  }
                }

                if (data.runs.length > 0) {
                  console.log(chalk.bold("\n  Recent Runs:"));
                  for (const run of data.runs) {
                    const icon =
                      run.status === "succeeded" ? "✅" : run.status === "failed" ? "❌" : "⏳";
                    console.log(
                      `    ${icon} ${chalk.dim(run.id)}  ${run.projectName}/${run.serviceName}  ${run.triggerKind}  by=${run.requestedBy}  ${run.startedAt}`
                    );
                  }
                }
                console.log("");
              }
            });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  backup
    .command("restore")
    .description("Queue a restore from a backup run")
    .requiredOption("--backup-run-id <id>", "Backup run ID to restore from")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: { backupRunId: string; json?: boolean; dryRun?: boolean; yes?: boolean },
        command: Command
      ) => {
        await runCommandAction<BackupRestoreCommandResult>({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            if (opts.dryRun) {
              try {
                const trpc = createClient();
                const plan = await trpc.backupRestorePlan.query({
                  backupRunId: normalizeCliInput(opts.backupRunId, "Backup run ID")
                });

                return ctx.dryRun(
                  {
                    dryRun: true,
                    plan
                  },
                  {
                    json: { ok: true, data: { dryRun: true, plan } },
                    human: () => {
                      renderBackupRestorePlan(plan);
                    }
                  }
                );
              } catch (error) {
                ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
              }
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To restore from backup ${normalizeCliInput(opts.backupRunId, "Backup run ID")}, add --yes`
            );

            try {
              const trpc = createClient();
              const backupRunId = normalizeCliInput(opts.backupRunId, "Backup run ID");
              const result = await trpc.queueBackupRestore.mutate({
                backupRunId
              });

              return ctx.success(result, {
                quiet: () => result.id,
                human: () => {
                  console.log(chalk.green(`✅ Restore queued: ${result.id}`));
                }
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  backup
    .command("run")
    .description("Trigger a one-off backup immediately via Temporal")
    .requiredOption("--policy <id>", "Backup policy ID")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: { policy: string; json?: boolean; dryRun?: boolean; yes?: boolean },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            if (opts.dryRun) {
              return emitBackupDryRunResult(ctx, {
                dryRun: true,
                action: "backup.run",
                policyId: normalizeCliInput(opts.policy, "Policy ID"),
                message: `Would trigger one-off backup for policy ${normalizeCliInput(opts.policy, "Policy ID")}`
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To trigger backup for policy ${normalizeCliInput(opts.policy, "Policy ID")}, add --yes`
            );

            try {
              const trpc = createClient();
              const policyId = normalizeCliInput(opts.policy, "Policy ID");
              const result = await trpc.triggerBackupNow.mutate({
                policyId
              });

              return ctx.success(result, {
                quiet: () => result.id,
                human: () => {
                  console.log(chalk.green(`✅ Backup triggered (run: ${result.id})`));
                }
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  backup
    .command("verify")
    .description("Verify a backup by performing a test restore")
    .requiredOption("--backup-run-id <id>", "Backup run ID to verify")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: { backupRunId: string; json?: boolean; dryRun?: boolean; yes?: boolean },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            if (opts.dryRun) {
              return emitBackupDryRunResult(ctx, {
                dryRun: true,
                action: "backup.verify",
                backupRunId: normalizeCliInput(opts.backupRunId, "Backup run ID"),
                message: "Would trigger a test restore to verify this backup"
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To verify backup ${normalizeCliInput(opts.backupRunId, "Backup run ID")}, add --yes`
            );

            try {
              const trpc = createClient();
              const backupRunId = normalizeCliInput(opts.backupRunId, "Backup run ID");
              const result = await trpc.triggerTestRestore.mutate({
                backupRunId
              });

              return ctx.success(result, {
                quiet: () => result.id,
                human: () => {
                  console.log(chalk.green(`✅ Test restore queued: ${result.id}`));
                  console.log(
                    chalk.dim("  The backup will be downloaded and verified. Check status with:")
                  );
                  console.log(chalk.dim("  daoflow backup list --json | jq '.runs[]'"));
                }
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  backup
    .command("download")
    .description("Get download info for a backup artifact")
    .requiredOption("--backup-run-id <id>", "Backup run ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { backupRunId: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          const trpc = createClient();
          const run = await trpc.backupRunDetails.query({
            runId: normalizeCliInput(opts.backupRunId, "Backup run ID")
          });
          const info = buildBackupDownloadInfo(run);

          return ctx.success(info, {
            human: () => {
              renderBackupDownloadInfo(info);
            }
          });
        }
      });
    });

  return backup;
}
