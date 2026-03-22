import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  normalizeCliInput,
  normalizeOptionalCliInput,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient } from "../trpc-client";
import { emitBackupDryRunResult, renderBackupError } from "./backup-shared";

export function registerBackupDestinationCommands(backup: Command): void {
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
          emitJsonSuccess({ destinations: data });
          return;
        }

        console.log(chalk.bold("\n📍 Backup Destinations\n"));
        if (data.length === 0) {
          console.log("  No destinations configured.\n");
          return;
        }

        for (const destination of data) {
          const status =
            destination.lastTestResult === "success"
              ? chalk.green("✅")
              : destination.lastTestResult === "failed"
                ? chalk.red("❌")
                : chalk.dim("⏳");
          const target =
            destination.provider === "s3"
              ? `${destination.bucket ?? ""}${destination.region ? ` (${destination.region})` : ""}`
              : destination.provider === "local"
                ? (destination.localPath ?? "")
                : (destination.rcloneRemotePath ?? "");
          console.log(
            `  ${status} ${chalk.bold(destination.name)}  ${chalk.dim(destination.provider)}  ${target}  ${chalk.dim(destination.id)}`
          );
        }
        console.log("");
      } catch (error) {
        emitJsonError(getErrorMessage(error), "API_ERROR");
        process.exit(1);
      }
    });

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
        await runCommandAction({
          command,
          json: opts.json,
          renderError: renderBackupError,
          action: async (ctx) => {
            if (opts.dryRun) {
              return emitBackupDryRunResult(ctx, {
                dryRun: true,
                action: "destination.create",
                name: normalizeCliInput(opts.name, "Destination name"),
                provider: normalizeCliInput(opts.provider, "Destination provider", {
                  allowPathTraversal: true
                }),
                message: `Would create backup destination "${normalizeCliInput(opts.name, "Destination name")}" (${normalizeCliInput(opts.provider, "Destination provider", { allowPathTraversal: true })})`
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `To create destination "${normalizeCliInput(opts.name, "Destination name")}", add --yes`
            );

            try {
              const trpc = createClient();
              const result = await trpc.createBackupDestination.mutate({
                name: normalizeCliInput(opts.name, "Destination name"),
                provider: normalizeCliInput(opts.provider, "Destination provider", {
                  allowPathTraversal: true
                }) as "s3" | "local" | "gdrive" | "onedrive" | "dropbox" | "sftp" | "rclone",
                accessKey: normalizeOptionalCliInput(opts.accessKey, "Access key", {
                  allowPathTraversal: true,
                  allowShellMetacharacters: true,
                  maxLength: 512
                }),
                secretAccessKey: normalizeOptionalCliInput(opts.secretKey, "Secret access key", {
                  allowPathTraversal: true,
                  allowShellMetacharacters: true,
                  maxLength: 512
                }),
                bucket: normalizeOptionalCliInput(opts.bucket, "Bucket"),
                region: normalizeOptionalCliInput(opts.region, "Region", {
                  allowPathTraversal: true
                }),
                endpoint: normalizeOptionalCliInput(opts.endpoint, "Endpoint", {
                  allowPathTraversal: true,
                  allowShellMetacharacters: true,
                  maxLength: 2048
                }),
                s3Provider: normalizeOptionalCliInput(opts.s3Provider, "S3 provider", {
                  allowPathTraversal: true
                }),
                localPath: normalizeOptionalCliInput(opts.localPath, "Local path", {
                  maxLength: 1024
                }),
                rcloneConfig: normalizeOptionalCliInput(opts.rcloneConfig, "rclone config", {
                  allowPathTraversal: true,
                  allowShellMetacharacters: true,
                  maxLength: 4096
                }),
                rcloneRemotePath: normalizeOptionalCliInput(
                  opts.rcloneRemotePath,
                  "rclone remote path",
                  {
                    maxLength: 1024
                  }
                )
              });

              return ctx.success(result, {
                quiet: () => result.id,
                human: () => {
                  console.log(chalk.green(`✅ Destination created: ${result.id}`));
                }
              });
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

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
          if (result.success) {
            emitJsonSuccess({ success: true, error: null });
            return;
          }

          emitJsonError(result.error ?? "Connection failed", "DESTINATION_TEST_FAILED");
          process.exit(1);
        }

        if (result.success) {
          console.log(chalk.green("✅ Connection successful"));
        } else {
          console.log(chalk.red(`❌ Connection failed: ${result.error ?? "unknown error"}`));
          process.exit(1);
        }
      } catch (error) {
        emitJsonError(getErrorMessage(error), "API_ERROR");
        process.exit(1);
      }
    });

  destination
    .command("delete")
    .description("Delete a backup destination")
    .requiredOption("--id <id>", "Destination ID")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts: { id: string; json?: boolean; yes?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderBackupError,
        action: async (ctx) => {
          const destinationId = normalizeCliInput(opts.id, "Destination ID");

          ctx.requireConfirmation(
            opts.yes === true,
            `To delete destination ${destinationId}, add --yes`
          );

          try {
            const trpc = createClient();
            const result = await trpc.deleteBackupDestination.mutate({ id: destinationId });

            return ctx.success(result, {
              quiet: () => destinationId,
              human: () => {
                console.log(chalk.green("✅ Destination deleted"));
              }
            });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });
}
