/**
 * backup.ts — CLI commands for backup management.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   backup list  → read lane, backup:read
 *   backup run   → command lane, backup:run
 *   backup restore → command lane, backup:restore + approvals:create
 *
 * T-33, T-34, T-35: Backup CLI commands
 */

import { Command } from "commander";
import chalk from "chalk";
import { createClient } from "../trpc-client";

export function backupCommand(): Command {
  const backup = new Command("backup").description("Manage backup policies and runs");

  // ── backup list ────────────────────────────────────────────
  backup
    .command("list")
    .description("List backup policies and recent runs")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max runs to show", "12")
    .action(async (opts: { json?: boolean; limit: string }) => {
      try {
        const trpc = createClient();
        const data = await trpc.backupOverview.query({ limit: Number(opts.limit) });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, ...data }, null, 2));
          return;
        }

        console.log(chalk.bold("\n📦 Backup Overview\n"));
        console.log(`  Policies:  ${data.summary.totalPolicies}`);
        console.log(`  Queued:    ${data.summary.queuedRuns}`);
        console.log(`  Running:   ${data.summary.runningRuns}`);
        console.log(`  Succeeded: ${chalk.green(data.summary.succeededRuns)}`);
        console.log(`  Failed:    ${chalk.red(data.summary.failedRuns)}`);

        if (data.policies.length > 0) {
          console.log(chalk.bold("\n  Policies:"));
          for (const p of data.policies) {
            console.log(
              `    ${chalk.dim(p.id)}  ${p.projectName}/${p.serviceName}  ${p.targetType}  schedule=${p.scheduleLabel}  retain=${p.retentionCount}`
            );
          }
        }

        if (data.runs.length > 0) {
          console.log(chalk.bold("\n  Recent Runs:"));
          for (const r of data.runs) {
            const icon = r.status === "succeeded" ? "✅" : r.status === "failed" ? "❌" : "⏳";
            console.log(
              `    ${icon} ${chalk.dim(r.id)}  ${r.projectName}/${r.serviceName}  ${r.triggerKind}  by=${r.requestedBy}  ${r.startedAt}`
            );
          }
        }
        console.log("");
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  // ── backup run ─────────────────────────────────────────────
  backup
    .command("run")
    .description("Trigger a backup run for a policy")
    .requiredOption("--policy-id <id>", "Backup policy ID")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { policyId: string; json?: boolean; dryRun?: boolean; yes?: boolean }) => {
      if (opts.dryRun) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              dryRun: true,
              action: "backup.run",
              policyId: opts.policyId,
              message: "Would trigger a backup run for this policy"
            },
            null,
            2
          )
        );
        process.exit(3);
      }

      try {
        const trpc = createClient();

        if (!opts.yes) {
          console.error(`To trigger backup for policy ${opts.policyId}, add --yes`);
          process.exit(1);
        }

        const result = await trpc.triggerBackupRun.mutate({ policyId: opts.policyId });

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        } else {
          console.log(chalk.green(`✅ Backup run queued: ${result.id}`));
        }
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  // ── backup restore ─────────────────────────────────────────
  backup
    .command("restore")
    .description("Queue a restore from a backup run")
    .requiredOption("--backup-run-id <id>", "Backup run ID to restore from")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (opts: { backupRunId: string; json?: boolean; dryRun?: boolean; yes?: boolean }) => {
        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                action: "backup.restore",
                backupRunId: opts.backupRunId,
                message: "Would queue a restore from this backup run"
              },
              null,
              2
            )
          );
          process.exit(3);
        }

        try {
          const trpc = createClient();

          if (!opts.yes) {
            console.error(`To restore from backup ${opts.backupRunId}, add --yes`);
            process.exit(1);
          }

          const result = await trpc.queueBackupRestore.mutate({ backupRunId: opts.backupRunId });

          if (opts.json) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
          } else {
            console.log(chalk.green(`✅ Restore queued: ${result.id}`));
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Unknown error"
            })
          );
          process.exit(1);
        }
      }
    );

  return backup;
}
