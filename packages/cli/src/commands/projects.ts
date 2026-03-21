import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient } from "../trpc-client";
import type {
  ProjectDetailsOutput,
  ProjectEnvironmentItem,
  ProjectListItem
} from "../trpc-contract";

function collectValues(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

function trimOrUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRepeatedValues(values?: string[]) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function summarizeProject(project: ProjectListItem | ProjectDetailsOutput) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    repoFullName: project.repoFullName,
    repoUrl: project.repoUrl,
    sourceType: project.sourceType,
    status: project.status,
    statusTone: project.statusTone,
    defaultBranch: project.defaultBranch,
    autoDeploy: project.autoDeploy,
    composeFiles: project.composeFiles,
    composeProfiles: project.composeProfiles,
    environmentCount: project.environmentCount,
    serviceCount: project.serviceCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function summarizeEnvironment(environment: ProjectEnvironmentItem) {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    status: environment.status,
    statusTone: environment.statusTone,
    targetServerId: environment.targetServerId,
    composeFiles: environment.composeFiles,
    composeProfiles: environment.composeProfiles,
    serviceCount: environment.serviceCount,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt
  };
}

function renderProjectListHuman(projects: ProjectListItem[]) {
  if (projects.length === 0) {
    console.log(
      "No projects found. Create one with `daoflow projects create --yes` or the web dashboard."
    );
    return;
  }

  console.log(chalk.bold("\n  Projects\n"));
  for (const project of projects) {
    console.log(`  ${chalk.cyan(project.name)}  (${project.id})`);
    console.log(
      chalk.dim(
        `    ${project.environmentCount} environment(s) · ${project.serviceCount} service(s) · ${project.status}`
      )
    );
    if (project.repoFullName || project.repoUrl) {
      console.log(chalk.dim(`    ${project.repoFullName ?? project.repoUrl}`));
    }
  }
  console.log();
}

function renderProjectDetailsHuman(project: ProjectDetailsOutput) {
  console.log(chalk.bold(`\n  Project ${project.name}\n`));
  console.log(`  ID:           ${project.id}`);
  console.log(`  Status:       ${project.status}`);
  console.log(`  Source:       ${project.sourceType}`);
  console.log(`  Repo:         ${project.repoFullName ?? project.repoUrl ?? "—"}`);
  console.log(`  Branch:       ${project.defaultBranch ?? "—"}`);
  console.log(`  Auto-deploy:  ${project.autoDeploy ? "enabled" : "disabled"}`);
  console.log(`  Environments: ${project.environmentCount}`);
  console.log(`  Services:     ${project.serviceCount}`);
  if (project.description) {
    console.log(`  Description:  ${project.description}`);
  }
  if (project.composeFiles.length > 0) {
    console.log(`  Compose:      ${project.composeFiles.join(", ")}`);
  }
  if (project.composeProfiles.length > 0) {
    console.log(`  Profiles:     ${project.composeProfiles.join(", ")}`);
  }

  if (project.environments.length > 0) {
    console.log(chalk.bold("\n  Environments\n"));
    for (const environment of project.environments) {
      console.log(`  ${chalk.cyan(environment.name)}  (${environment.id})`);
      console.log(
        chalk.dim(
          `    ${environment.status} · ${environment.serviceCount} service(s) · server ${environment.targetServerId ?? "inherit"}`
        )
      );
      if (environment.composeFiles.length > 0) {
        console.log(chalk.dim(`    Compose: ${environment.composeFiles.join(", ")}`));
      }
      if (environment.composeProfiles.length > 0) {
        console.log(chalk.dim(`    Profiles: ${environment.composeProfiles.join(", ")}`));
      }
    }
  }
  console.log();
}

function renderEnvironmentListHuman(environments: ProjectEnvironmentItem[]) {
  if (environments.length === 0) {
    console.log("No environments found for this project.");
    return;
  }

  console.log(chalk.bold("\n  Environments\n"));
  for (const environment of environments) {
    console.log(`  ${chalk.cyan(environment.name)}  (${environment.id})`);
    console.log(
      chalk.dim(
        `    ${environment.status} · ${environment.serviceCount} service(s) · server ${environment.targetServerId ?? "inherit"}`
      )
    );
    if (environment.composeFiles.length > 0) {
      console.log(chalk.dim(`    Compose: ${environment.composeFiles.join(", ")}`));
    }
    if (environment.composeProfiles.length > 0) {
      console.log(chalk.dim(`    Profiles: ${environment.composeProfiles.join(", ")}`));
    }
  }
  console.log();
}

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("List and manage projects and environments");

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
          const project = await trpc.projectDetails.query({ projectId: projectId.trim() });

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
              name: opts.name.trim(),
              description: trimOrUndefined(opts.description),
              repoUrl: trimOrUndefined(opts.repoUrl),
              repoFullName: trimOrUndefined(opts.repoFullName),
              defaultBranch: trimOrUndefined(opts.defaultBranch),
              composeFiles: normalizeRepeatedValues(opts.composeFile),
              composeProfiles: normalizeRepeatedValues(opts.composeProfile),
              autoDeploy: opts.autoDeploy ?? false,
              autoDeployBranch: trimOrUndefined(opts.autoDeployBranch)
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
            const projectId = opts.project.trim();
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
                human: () => {
                  console.log(chalk.green(`✓ Deleted project ${projectId}`));
                }
              }
            );
          }
        });
      }
    );

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
          const environments = await trpc.projectEnvironments.query({
            projectId: opts.project.trim()
          });

          return ctx.success(
            {
              projectId: opts.project.trim(),
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
              projectId: opts.project.trim(),
              name: opts.name.trim(),
              targetServerId: trimOrUndefined(opts.server),
              composeFiles: normalizeRepeatedValues(opts.composeFile),
              composeProfiles: normalizeRepeatedValues(opts.composeProfile)
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
            const composeFiles = normalizeRepeatedValues(opts.composeFile);
            const composeProfiles = normalizeRepeatedValues(opts.composeProfile);
            const payload = {
              environmentId: opts.environment.trim(),
              name: trimOrUndefined(opts.name),
              status: trimOrUndefined(opts.status),
              targetServerId: opts.clearServer ? "" : trimOrUndefined(opts.server),
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
            const environmentId = opts.environment.trim();
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
                human: () => {
                  console.log(chalk.green(`✓ Deleted environment ${environmentId}`));
                }
              }
            );
          }
        });
      }
    );

  cmd.addCommand(env);

  return cmd;
}
