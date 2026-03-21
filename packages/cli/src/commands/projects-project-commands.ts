import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";
import { renderProjectDetailsHuman, renderProjectListHuman } from "./projects-renderers";
import {
  collectValues,
  normalizeRepeatedValues,
  summarizeEnvironment,
  summarizeProject
} from "./projects-shared";

export function registerProjectCommands(cmd: Command) {
  cmd
    .command("list")
    .alias("ls")
    .option("--json", "Output as JSON")
    .description("List accessible projects")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction<unknown>({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const projects = await trpc.projects.query({ limit: 50 });

          return ctx.success(
            {
              summary: {
                totalProjects: projects.length,
                totalEnvironments: projects.reduce(
                  (sum, project) => sum + project.environmentCount,
                  0
                ),
                totalServices: projects.reduce((sum, project) => sum + project.serviceCount, 0)
              },
              projects: projects.map(summarizeProject)
            },
            {
              human: () => renderProjectListHuman(projects)
            }
          );
        }
      });
    });

  cmd
    .command("show")
    .argument("<project-id>", "Project ID")
    .option("--json", "Output as JSON")
    .description("Show project metadata and environments")
    .action(async (projectId: string, opts: { json?: boolean }, command: Command) => {
      await runCommandAction<unknown>({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const normalizedProjectId = normalizeCliInput(projectId, "Project ID");
          const project = await trpc.projectDetails.query({ projectId: normalizedProjectId });

          return ctx.success(
            {
              project: summarizeProject(project),
              environments: project.environments.map(summarizeEnvironment)
            },
            {
              human: () => renderProjectDetailsHuman(project)
            }
          );
        }
      });
    });

  cmd
    .command("create")
    .requiredOption("--name <name>", "Project name")
    .option("--description <text>", "Project description")
    .option("--repo-url <url>", "Repository URL")
    .option("--repo-full-name <owner/repo>", "Repository full name")
    .option("--default-branch <name>", "Default branch")
    .option("--compose-file <path>", "Compose file override", collectValues, [])
    .option("--compose-profile <name>", "Compose profile override", collectValues, [])
    .option("--auto-deploy", "Enable webhook auto-deploy")
    .option("--auto-deploy-branch <branch>", "Auto-deploy branch")
    .option("--dry-run", "Preview the project payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Create a project")
    .action(
      async (
        opts: {
          name: string;
          description?: string;
          repoUrl?: string;
          repoFullName?: string;
          defaultBranch?: string;
          composeFile?: string[];
          composeProfile?: string[];
          autoDeploy?: boolean;
          autoDeployBranch?: string;
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
              name: normalizeCliInput(opts.name, "Project name"),
              description: normalizeOptionalCliInput(opts.description, "Project description", {
                maxLength: 512
              }),
              repoUrl: normalizeOptionalCliInput(opts.repoUrl, "Repository URL", {
                allowPathTraversal: true,
                allowShellMetacharacters: true,
                maxLength: 2048
              }),
              repoFullName: normalizeOptionalCliInput(opts.repoFullName, "Repository full name"),
              defaultBranch: normalizeOptionalCliInput(opts.defaultBranch, "Default branch"),
              composeFiles: normalizeRepeatedValues(opts.composeFile, "Compose file"),
              composeProfiles: normalizeRepeatedValues(opts.composeProfile, "Compose profile"),
              autoDeploy: opts.autoDeploy ?? false,
              autoDeployBranch: normalizeOptionalCliInput(
                opts.autoDeployBranch,
                "Auto-deploy branch"
              )
            };

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  ...payload
                },
                {
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: create project ${payload.name}\n`));
                    console.log(
                      `  Repo:         ${payload.repoFullName ?? payload.repoUrl ?? "—"}`
                    );
                    console.log(`  Branch:       ${payload.defaultBranch ?? "main"}`);
                    console.log(`  Auto-deploy:  ${payload.autoDeploy ? "enabled" : "disabled"}`);
                    if (payload.composeFiles.length > 0) {
                      console.log(`  Compose:      ${payload.composeFiles.join(", ")}`);
                    }
                    if (payload.composeProfiles.length > 0) {
                      console.log(`  Profiles:     ${payload.composeProfiles.join(", ")}`);
                    }
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Create project ${payload.name}. Pass --yes to confirm.`,
              {
                humanMessage: `Create project ${payload.name}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const project = await trpc.createProject.mutate({
              ...payload,
              composeFiles: payload.composeFiles.length > 0 ? payload.composeFiles : undefined,
              composeProfiles:
                payload.composeProfiles.length > 0 ? payload.composeProfiles : undefined
            });

            return ctx.success(
              {
                project: {
                  id: project.id,
                  name: project.name,
                  repoFullName: project.repoFullName,
                  repoUrl: project.repoUrl,
                  status: project.status
                }
              },
              {
                quiet: () => project.id,
                human: () => {
                  console.log(chalk.green(`✓ Created project ${project.name} (${project.id})`));
                  if (project.repoFullName || project.repoUrl) {
                    console.log(chalk.dim(`  ${project.repoFullName ?? project.repoUrl}`));
                  }
                  console.log();
                }
              }
            );
          }
        });
      }
    );

  cmd
    .command("delete")
    .requiredOption("--project <id>", "Project ID")
    .option("--dry-run", "Preview the deletion without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Delete a project")
    .action(
      async (
        opts: { project: string; dryRun?: boolean; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const projectId = normalizeCliInput(opts.project, "Project ID");
            if (opts.dryRun) {
              return ctx.dryRun(
                { dryRun: true, projectId },
                {
                  human: () => {
                    console.log(chalk.bold(`\n  Dry-run: delete project ${projectId}\n`));
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Delete project ${projectId}. Pass --yes to confirm.`,
              {
                humanMessage: `Delete project ${projectId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            await trpc.deleteProject.mutate({ projectId });

            return ctx.success(
              { deleted: true, projectId },
              {
                quiet: () => projectId,
                human: () => {
                  console.log(chalk.green(`✓ Deleted project ${projectId}`));
                }
              }
            );
          }
        });
      }
    );
}
