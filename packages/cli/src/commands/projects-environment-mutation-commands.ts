import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { collectValues, normalizeRepeatedValues } from "./projects-shared";

export function registerProjectsEnvironmentMutationCommands(env: Command) {
  env
    .command("create")
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--name <name>", "Environment name")
    .option("--server <id>", "Target server ID override")
    .option("--compose-file <path>", "Compose file override", collectValues, [])
    .option("--compose-profile <name>", "Compose profile override", collectValues, [])
    .option("--dry-run", "Preview the environment payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Create an environment inside a project")
    .action(
      async (
        opts: {
          project: string;
          name: string;
          server?: string;
          composeFile?: string[];
          composeProfile?: string[];
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
            const payload = {
              projectId: normalizeCliInput(opts.project, "Project ID"),
              name: normalizeCliInput(opts.name, "Environment name"),
              targetServerId: normalizeOptionalCliInput(opts.server, "Target server ID"),
              composeFiles: normalizeRepeatedValues(opts.composeFile, "Compose file"),
              composeProfiles: normalizeRepeatedValues(opts.composeProfile, "Compose profile")
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: create environment ${payload.name}\n`));
                    console.log(`  Project:  ${payload.projectId}`);
                    console.log(`  Server:   ${payload.targetServerId ?? "inherit"}`);
                    if (payload.composeFiles.length > 0) {
                      console.log(`  Compose:  ${payload.composeFiles.join(", ")}`);
                    }
                    if (payload.composeProfiles.length > 0) {
                      console.log(`  Profiles: ${payload.composeProfiles.join(", ")}`);
                    }
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create environment ${payload.name} in project ${payload.projectId}. Pass --yes to confirm.`,
              {
                humanMessage: `Create environment ${payload.name} in project ${payload.projectId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const environment = await trpc.createEnvironment.mutate({
              ...payload,
              targetServerId: payload.targetServerId,
              composeFiles: payload.composeFiles.length > 0 ? payload.composeFiles : undefined,
              composeProfiles:
                payload.composeProfiles.length > 0 ? payload.composeProfiles : undefined
            });

            return ctx.success(
              {
                environment: {
                  id: environment.id,
                  projectId: environment.projectId,
                  name: environment.name,
                  status: environment.status
                }
              },
              {
                quiet: () => environment.id,
                human: () => {
                  console.log(
                    chalk.green(`✓ Created environment ${environment.name} (${environment.id})`)
                  );
                  console.log(chalk.dim(`  Project: ${environment.projectId}`));
                  console.log();
                }
              }
            );
          }
        });
      }
    );

  env
    .command("update")
    .requiredOption("--environment <id>", "Environment ID")
    .option("--name <name>", "Rename the environment")
    .option("--status <status>", "Set environment status")
    .option("--server <id>", "Set a target server override")
    .option("--clear-server", "Remove the target server override")
    .option("--compose-file <path>", "Replace compose file overrides", collectValues, [])
    .option("--compose-profile <name>", "Replace compose profile overrides", collectValues, [])
    .option("--clear-compose-overrides", "Remove compose file/profile overrides")
    .option("--dry-run", "Preview the environment update without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Update environment overrides")
    .action(
      async (
        opts: {
          environment: string;
          name?: string;
          status?: string;
          server?: string;
          clearServer?: boolean;
          composeFile?: string[];
          composeProfile?: string[];
          clearComposeOverrides?: boolean;
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
            const composeFiles = normalizeRepeatedValues(opts.composeFile, "Compose file");
            const composeProfiles = normalizeRepeatedValues(opts.composeProfile, "Compose profile");
            const payload = {
              environmentId: normalizeCliInput(opts.environment, "Environment ID"),
              name: normalizeOptionalCliInput(opts.name, "Environment name"),
              status: normalizeOptionalCliInput(opts.status, "Environment status"),
              targetServerId: opts.clearServer
                ? ""
                : normalizeOptionalCliInput(opts.server, "Target server ID"),
              composeFiles: opts.clearComposeOverrides ? [] : composeFiles,
              composeProfiles: opts.clearComposeOverrides ? [] : composeProfiles
            };

            if (
              !payload.name &&
              !payload.status &&
              payload.targetServerId === undefined &&
              !opts.clearComposeOverrides &&
              composeFiles.length === 0 &&
              composeProfiles.length === 0
            ) {
              ctx.fail("Provide at least one environment change.", { code: "INVALID_INPUT" });
            }

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  human: () => {
                    console.log(
                      chalk.bold(`\n  Dry-run: update environment ${payload.environmentId}\n`)
                    );
                    if (payload.name) console.log(`  Name:     ${payload.name}`);
                    if (payload.status) console.log(`  Status:   ${payload.status}`);
                    if (payload.targetServerId !== undefined) {
                      console.log(`  Server:   ${payload.targetServerId || "inherit"}`);
                    }
                    if (opts.clearComposeOverrides) {
                      console.log("  Compose:  cleared");
                    } else {
                      if (payload.composeFiles.length > 0) {
                        console.log(`  Compose:  ${payload.composeFiles.join(", ")}`);
                      }
                      if (payload.composeProfiles.length > 0) {
                        console.log(`  Profiles: ${payload.composeProfiles.join(", ")}`);
                      }
                    }
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Update environment ${payload.environmentId}. Pass --yes to confirm.`,
              {
                humanMessage: `Update environment ${payload.environmentId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const environment = await trpc.updateEnvironment.mutate({
              environmentId: payload.environmentId,
              name: payload.name,
              status: payload.status,
              targetServerId: payload.targetServerId,
              composeFiles:
                opts.clearComposeOverrides || payload.composeFiles.length > 0
                  ? payload.composeFiles
                  : undefined,
              composeProfiles:
                opts.clearComposeOverrides || payload.composeProfiles.length > 0
                  ? payload.composeProfiles
                  : undefined
            });

            return ctx.success(
              {
                environment: {
                  id: environment.id,
                  projectId: environment.projectId,
                  name: environment.name,
                  status: environment.status
                }
              },
              {
                quiet: () => environment.id,
                human: () => {
                  console.log(
                    chalk.green(`✓ Updated environment ${environment.name} (${environment.id})`)
                  );
                  console.log();
                }
              }
            );
          }
        });
      }
    );
}
