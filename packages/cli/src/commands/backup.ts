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

  // ── backup destinations ─────────────────────────────────────
  backup
    .command("destinations")
    .description("List backup destinations")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const trpc = createClient();
        const data = await trpc.backupDestinations.query({});

        if (opts.json) {
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
      async (opts: {
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
      }) => {
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

          if (opts.json) {
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
    .action(async (opts: { id: string; json?: boolean }) => {
      try {
        const trpc = createClient();
        const result = await trpc.testBackupDestination.mutate({ id: opts.id });

        if (opts.json) {
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
    .action(async (opts: { id: string; json?: boolean; yes?: boolean }) => {
      if (!opts.yes) {
        console.error(`To delete destination ${opts.id}, add --yes`);
        process.exit(1);
      }

      try {
        const trpc = createClient();
        const result = await trpc.deleteBackupDestination.mutate({ id: opts.id });

        if (opts.json) {
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

  return backup;
}
