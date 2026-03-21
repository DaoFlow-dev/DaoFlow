import { Command } from "commander";
import { createProjectsEnvironmentCommand } from "./projects-environment-commands";
import { registerProjectCommands } from "./projects-project-commands";

export function projectsCommand(): Command {
  const cmd = new Command("projects").description("List and manage projects and environments");
  registerProjectCommands(cmd);
  cmd.addCommand(createProjectsEnvironmentCommand());

  return cmd;
}
