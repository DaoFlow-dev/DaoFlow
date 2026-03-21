import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { registerProjectsEnvironmentMutationCommands } from "./projects-environment-mutation-commands";
import { renderEnvironmentListHuman } from "./projects-renderers";
import { summarizeEnvironment } from "./projects-shared";

export function createProjectsEnvironmentCommand() {
  const env = new Command("env").description("Manage project environments");

  env
    .command("list")
    .requiredOption("--project <id>", "Project ID")
    .option("--json", "Output as JSON")
    .description("List environments for a project")
    .action(async (opts: { project: string; json?: boolean }, command: Command) => {
      await runCommandAction<unknown>({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const projectId = normalizeCliInput(opts.project, "Project ID");
          const environments = await trpc.projectEnvironments.query({
            projectId
          });

          return ctx.success(
            {
              projectId,
              summary: {
                totalEnvironments: environments.length,
                totalServices: environments.reduce(
                  (sum, environment) => sum + environment.serviceCount,
                  0
                )
              },
              environments: environments.map(summarizeEnvironment)
            },
            {
              human: () => renderEnvironmentListHuman(environments)
            }
          );
        }
      });
    });

  registerProjectsEnvironmentMutationCommands(env);

  env
    .command("delete")
    .requiredOption("--environment <id>", "Environment ID")
    .option("--dry-run", "Preview the deletion without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Delete an environment")
    .action(
      async (
        opts: { environment: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const environmentId = normalizeCliInput(opts.environment, "Environment ID");
            if (opts.dryRun) {
              return ctx.dryRun(
                { dryRun: true, environmentId },
                {
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: delete environment ${environmentId}\n`));
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Delete environment ${environmentId}. Pass --yes to confirm.`,
              {
                humanMessage: `Delete environment ${environmentId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            await trpc.deleteEnvironment.mutate({ environmentId });

            return ctx.success(
              { deleted: true, environmentId },
              {
                quiet: () => environmentId,
                human: () => {
                  console.log(chalk.green(`✓ Deleted environment ${environmentId}`));
                }
              }
            );
          }
        });
      }
    );

  return env;
}
