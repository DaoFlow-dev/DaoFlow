import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import type { ServiceRuntimeLoggingOutput } from "../trpc-contract";
import {
  CLEAR_HELP,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_SIZE_MB,
  MAX_FILES,
  MAX_RETENTION_MB,
  MAX_SIZE_MB,
  SET_HELP,
  SHOW_HELP,
  parseBoundedInteger,
  printInspection,
  readLoggingConfig
} from "./service-logging-command-support";

export function serviceLoggingCommand(): Command {
  const logging = new Command("logging").description(
    "Configure and inspect per-service Docker log rotation"
  );

  logging
    .command("show")
    .alias("inspect")
    .description("Show desired rotation and inspect deployed container logging")
    .requiredOption("--service <id>", "Service ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { service: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const serviceId = normalizeCliInput(opts.service, "Service ID");
          const trpc = createClient();
          const state = await trpc.serviceLoggingState.query({ serviceId });
          const inspection = {
            desired: state.desired,
            status: state.status,
            inspectedAt: state.inspectedAt,
            reason: state.reason,
            containers: state.containers
          };
          const configured = state.desired;

          return ctx.success(
            {
              service: state.service,
              configured,
              inspection
            },
            {
              quiet: () => state.status,
              human: () => {
                console.log(chalk.bold(`\n  Docker log rotation for ${state.service.name}\n`));
                if (configured) {
                  console.log(
                    `  Desired:      json-file, ${configured.maxSizeMb} MB, ${configured.maxFiles} files`
                  );
                  console.log(
                    `  Source owner: ${configured.allowSourceOverride ? "DaoFlow may replace source logging" : "source logging is preserved"}`
                  );
                } else {
                  console.log("  Desired:      not managed by DaoFlow");
                }
                printInspection(state);
                console.log();
              }
            }
          );
        }
      });
    })
    .addHelpText("after", SHOW_HELP);

  logging
    .command("set")
    .description("Enable or update managed json-file rotation")
    .requiredOption("--service <id>", "Service ID")
    .option("--max-size-mb <count>", "Maximum size of each log file in MB", "10")
    .option("--max-files <count>", "Number of rotated log files to keep", "3")
    .option(
      "--take-ownership",
      "Allow DaoFlow to replace logging already defined in the source Compose service"
    )
    .option("--dry-run", "Preview the exact Compose override without mutating")
    .option("-y, --yes", "Confirm the configuration change")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          service: string;
          maxSizeMb?: string;
          maxFiles?: string;
          takeOwnership?: boolean;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const serviceId = normalizeCliInput(opts.service, "Service ID");
            const maxSizeMb = parseBoundedInteger(
              opts.maxSizeMb,
              "Maximum log size",
              DEFAULT_MAX_SIZE_MB,
              MAX_SIZE_MB
            );
            const maxFiles = parseBoundedInteger(
              opts.maxFiles,
              "Maximum log files",
              DEFAULT_MAX_FILES,
              MAX_FILES
            );
            if (maxSizeMb * maxFiles > MAX_RETENTION_MB) {
              ctx.fail(
                `Combined log retention cannot exceed ${MAX_RETENTION_MB} MB per container.`,
                {
                  code: "INVALID_INPUT"
                }
              );
            }

            const proposed: ServiceRuntimeLoggingOutput = {
              managed: true,
              driver: "json-file",
              maxSizeMb,
              maxFiles,
              allowSourceOverride: opts.takeOwnership === true
            };

            if (opts.dryRun) {
              const preview = await createClient().previewServiceLoggingConfig.query({
                serviceId,
                logging: proposed
              });
              return ctx.dryRun(
                {
                  dryRun: true,
                  serviceId,
                  logging: preview.logging,
                  runtimeConfigPreview: preview.runtimeConfigPreview
                },
                {
                  human: () => {
                    console.log(chalk.bold("\n  Dry-run: managed Docker log rotation\n"));
                    console.log(
                      preview.runtimeConfigPreview ?? "  No override would be generated."
                    );
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Configure managed log rotation for service ${serviceId}. Pass --yes to confirm.`
            );

            const service = await createClient().updateServiceRuntimeConfig.mutate({
              serviceId,
              logging: proposed
            });
            const configured = readLoggingConfig(service.runtimeConfig);
            return ctx.success(
              {
                service: { id: service.id, name: service.name },
                logging: configured,
                runtimeConfigPreview: service.runtimeConfigPreview
              },
              {
                quiet: () => service.id,
                human: () => {
                  console.log(chalk.green(`✓ Configured log rotation for ${service.name}`));
                  console.log(
                    chalk.dim(
                      "  The active container setting changes after the service is redeployed."
                    )
                  );
                }
              }
            );
          }
        });
      }
    )
    .addHelpText("after", SET_HELP);

  logging
    .command("clear")
    .description("Stop managing log rotation and preserve source-authored logging")
    .requiredOption("--service <id>", "Service ID")
    .option("--dry-run", "Preview the resulting Compose override without mutating")
    .option("-y, --yes", "Confirm removal")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { service: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const serviceId = normalizeCliInput(opts.service, "Service ID");
            if (opts.dryRun) {
              const preview = await createClient().previewServiceLoggingConfig.query({
                serviceId,
                logging: null
              });
              return ctx.dryRun({
                dryRun: true,
                serviceId,
                logging: null,
                runtimeConfigPreview: preview.runtimeConfigPreview
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Remove managed log rotation for service ${serviceId}. Pass --yes to confirm.`
            );
            const service = await createClient().updateServiceRuntimeConfig.mutate({
              serviceId,
              logging: null
            });
            return ctx.success(
              {
                service: { id: service.id, name: service.name },
                logging: null,
                runtimeConfigPreview: service.runtimeConfigPreview
              },
              {
                quiet: () => service.id,
                human: () => {
                  console.log(chalk.green(`✓ Removed managed log rotation for ${service.name}`));
                  console.log(
                    chalk.dim(
                      "  DaoFlow-owned logging is removed on the next redeploy; source logging is preserved."
                    )
                  );
                }
              }
            );
          }
        });
      }
    )
    .addHelpText("after", CLEAR_HELP);

  return logging;
}
