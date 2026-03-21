import chalk from "chalk";
import type {
  ProjectDetailsOutput,
  ProjectEnvironmentItem,
  ProjectListItem
} from "../trpc-contract";

export function renderProjectListHuman(projects: ProjectListItem[]) {
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

export function renderProjectDetailsHuman(project: ProjectDetailsOutput) {
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

export function renderEnvironmentListHuman(environments: ProjectEnvironmentItem[]) {
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
