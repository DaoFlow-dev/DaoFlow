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
import { resolveCommandJsonOption } from "../command-helpers";
import { createClient } from "../trpc-client";

export function backupCommand(): Command {
  const backup = new Command("backup").description("Manage backup policies and runs");

  // ── backup list ────────────────────────────────────────────
  backup
    .command("list")
    .description("List backup policies and recent runs")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Max runs to show", "12")
    .action(async (opts: { json?: boolean; limit: string }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.backupOverview.query({ limit: Number(opts.limit) });

        if (isJson) {
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

  // ── backup restore ─────────────────────────────────────────
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
        const isJson = resolveCommandJsonOption(command, opts.json);

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

          if (isJson) {
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

  // ── backup destinations ─────────────────────────────────────
  backup
    .command("destinations")
    .description("List backup destinations")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.backupDestinations.query({});

        if (isJson) {
          console.log(JSON.stringify({ ok: true, destinations: data }, null, 2));
          return;
        }

        console.log(chalk.bold("\n📍 Backup Destinations\n"));
        if (data.length === 0) {
          console.log("  No destinations configured.\n");
          return;
        }
        for (const d of data) {
          const status =
            d.lastTestResult === "success"
              ? chalk.green("✅")
              : d.lastTestResult === "failed"
                ? chalk.red("❌")
                : chalk.dim("⏳");
          const target =
            d.provider === "s3"
              ? `${d.bucket ?? ""}${d.region ? ` (${d.region})` : ""}`
              : d.provider === "local"
                ? (d.localPath ?? "")
                : (d.rcloneRemotePath ?? "");
          console.log(
            `  ${status} ${chalk.bold(d.name)}  ${chalk.dim(d.provider)}  ${target}  ${chalk.dim(d.id)}`
          );
        }
        console.log("");
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  // ── backup destination add ─────────────────────────────────
  const destination = backup
    .command("destination")
    .description("Manage individual backup destinations");

  destination
    .command("add")
    .description("Add a new backup destination")
    .requiredOption("--name <name>", "Destination name")
    .requiredOption(
      "--provider <provider>",
      "Provider type (s3, local, gdrive, onedrive, dropbox, sftp, rclone)"
    )
    .option("--access-key <key>", "S3 access key")
    .option("--secret-key <key>", "S3 secret access key")
    .option("--bucket <bucket>", "S3 bucket name")
    .option("--region <region>", "S3 region")
    .option("--endpoint <url>", "S3 endpoint URL")
    .option("--s3-provider <provider>", "S3 sub-provider (AWS, Cloudflare, Minio, etc.)")
    .option("--local-path <path>", "Local filesystem path")
    .option("--rclone-config <config>", "Raw rclone config (INI format)")
    .option("--rclone-remote-path <path>", "Remote path within rclone backend")
    .option("--json", "Output as JSON")
    .option("--dry-run", "Preview without executing")
    .option("-y, --yes", "Skip confirmation")
    .action(
      async (
        opts: {
          name: string;
          provider: string;
          accessKey?: string;
          secretKey?: string;
          bucket?: string;
          region?: string;
          endpoint?: string;
          s3Provider?: string;
          localPath?: string;
          rcloneConfig?: string;
          rcloneRemotePath?: string;
          json?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                action: "destination.create",
                name: opts.name,
                provider: opts.provider,
                message: `Would create backup destination "${opts.name}" (${opts.provider})`
              },
              null,
              2
            )
          );
          process.exit(3);
        }

        if (!opts.yes) {
          console.error(`To create destination "${opts.name}", add --yes`);
          process.exit(1);
        }

        try {
          const trpc = createClient();
          const result = await trpc.createBackupDestination.mutate({
            name: opts.name,
            provider: opts.provider as
              | "s3"
              | "local"
              | "gdrive"
              | "onedrive"
              | "dropbox"
              | "sftp"
              | "rclone",
            accessKey: opts.accessKey,
            secretAccessKey: opts.secretKey,
            bucket: opts.bucket,
            region: opts.region,
            endpoint: opts.endpoint,
            s3Provider: opts.s3Provider,
            localPath: opts.localPath,
            rcloneConfig: opts.rcloneConfig,
            rcloneRemotePath: opts.rcloneRemotePath
          });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
          } else {
            console.log(chalk.green(`✅ Destination created: ${result.id}`));
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

  // ── backup destination test ────────────────────────────────
  destination
    .command("test")
    .description("Test connectivity to a backup destination")
    .requiredOption("--id <id>", "Destination ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { id: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const result = await trpc.testBackupDestination.mutate({ id: opts.id });

        if (isJson) {
          console.log(JSON.stringify({ ok: result.success, error: result.error ?? null }, null, 2));
          return;
        }

        if (result.success) {
          console.log(chalk.green(`✅ Connection successful`));
        } else {
          console.log(chalk.red(`❌ Connection failed: ${result.error ?? "unknown error"}`));
          process.exit(1);
        }
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  // ── backup destination delete ──────────────────────────────
  destination
    .command("delete")
    .description("Delete a backup destination")
    .requiredOption("--id <id>", "Destination ID")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { id: string; json?: boolean; yes?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      if (!opts.yes) {
        console.error(`To delete destination ${opts.id}, add --yes`);
        process.exit(1);
      }

      try {
        const trpc = createClient();
        const result = await trpc.deleteBackupDestination.mutate({ id: opts.id });

        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✅ Destination deleted`));
        }
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  // ── backup schedule ───────────────────────────────────────
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
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                action: "backup.schedule.enable",
                policyId: opts.policy,
                schedule: opts.cron,
                message: `Would enable cron schedule "${opts.cron}" for policy ${opts.policy}`
              },
              null,
              2
            )
          );
          process.exit(3);
        }

        if (!opts.yes) {
          console.error(`To enable schedule for policy ${opts.policy}, add --yes`);
          process.exit(1);
        }

        try {
          const trpc = createClient();
          const result = await trpc.enableBackupSchedule.mutate({
            policyId: opts.policy,
            schedule: opts.cron
          });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
          } else {
            console.log(
              chalk.green(
                `✅ Schedule enabled: ${result.schedule} (workflow: ${result.workflowId})`
              )
            );
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

  schedule
    .command("disable")
    .description("Disable the cron schedule for a backup policy")
    .requiredOption("--policy <id>", "Backup policy ID")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { policy: string; json?: boolean; yes?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      if (!opts.yes) {
        console.error(`To disable schedule for policy ${opts.policy}, add --yes`);
        process.exit(1);
      }

      try {
        const trpc = createClient();
        const result = await trpc.disableBackupSchedule.mutate({
          policyId: opts.policy
        });

        if (isJson) {
          console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        } else {
          console.log(chalk.green("✅ Schedule disabled"));
        }
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
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                action: "backup.run",
                policyId: opts.policy,
                message: `Would trigger one-off backup for policy ${opts.policy}`
              },
              null,
              2
            )
          );
          process.exit(3);
        }

        if (!opts.yes) {
          console.error(`To trigger backup for policy ${opts.policy}, add --yes`);
          process.exit(1);
        }

        try {
          const trpc = createClient();
          const result = await trpc.triggerBackupNow.mutate({
            policyId: opts.policy
          });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
          } else {
            console.log(chalk.green(`✅ Backup triggered (run: ${result.id})`));
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

  // ── backup verify ──────────────────────────────────────────
  // Task #46: Trigger a test restore to verify backup integrity
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
        const isJson = resolveCommandJsonOption(command, opts.json);

        if (opts.dryRun) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                action: "backup.verify",
                backupRunId: opts.backupRunId,
                message: "Would trigger a test restore to verify this backup"
              },
              null,
              2
            )
          );
          process.exit(3);
        }

        if (!opts.yes) {
          console.error(`To verify backup ${opts.backupRunId}, add --yes`);
          process.exit(1);
        }

        try {
          const trpc = createClient();
          const result = await trpc.triggerTestRestore.mutate({ backupRunId: opts.backupRunId });

          if (isJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
          } else {
            console.log(chalk.green(`✅ Test restore queued: ${result.id}`));
            console.log(
              chalk.dim("  The backup will be downloaded and verified. Check status with:")
            );
            console.log(chalk.dim(`  daoflow backup list --json | jq '.runs[]'`));
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

  // ── backup download ───────────────────────────────────────
  // Task #47: Show download information for a backup artifact
  backup
    .command("download")
    .description("Get download info for a backup artifact")
    .requiredOption("--backup-run-id <id>", "Backup run ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { backupRunId: string; json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const data = await trpc.backupOverview.query({ limit: 100 });
        const run = data.runs.find((r: { id: string }) => r.id === opts.backupRunId);

        if (!run) {
          const error = "Backup run not found";
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error }, null, 2));
          } else {
            console.error(chalk.red(`❌ ${error}`));
          }
          process.exit(1);
        }

        // Cast to access fields that may not be typed yet
        const runData = run as Record<string, unknown>;
        const info = {
          ok: true,
          id: run.id,
          status: run.status,
          artifact: run.artifactPath ?? null,
          size: (runData.sizeBytes as string | null) ?? null,
          encryption: (runData.encryption as string | null) ?? "none",
          message:
            run.status === "succeeded"
              ? "Use rclone to download from the artifact path"
              : "Backup has not completed successfully"
        };

        if (isJson) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          console.log(chalk.bold("\n📥 Backup Download Info\n"));
          console.log(`  ID:         ${run.id}`);
          console.log(`  Status:     ${run.status}`);
          console.log(`  Artifact:   ${run.artifactPath ?? chalk.dim("none")}`);
          if (runData.sizeBytes) {
            console.log(`  Size:       ${(Number(runData.sizeBytes) / 1024 / 1024).toFixed(2)} MB`);
          }
          console.log("");
        }
      } catch (err) {
        console.error(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown error" })
        );
        process.exit(1);
      }
    });

  return backup;
}
