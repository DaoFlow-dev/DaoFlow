#!/usr/bin/env bun
import { Command } from "commander";
import { loginCommand } from "./commands/login";
import { servicesCommand } from "./commands/services";
import { deployCommand } from "./commands/deploy";
import { pushCommand } from "./commands/push";
import { envCommand } from "./commands/env";
import { logsCommand } from "./commands/logs";
import { planCommand } from "./commands/plan";
import { rollbackCommand } from "./commands/rollback";
import { statusCommand } from "./commands/status";
import { projectsCommand } from "./commands/projects";
import { doctorCommand } from "./commands/doctor";
import { whoamiCommand } from "./commands/whoami";
import { capabilitiesCommand } from "./commands/capabilities";
import { installCommand } from "./commands/install";
import { upgradeCommand } from "./commands/upgrade";
import { uninstallCommand } from "./commands/uninstall";

const program = new Command();

program
  .name("daoflow")
  .description("DaoFlow CLI — agentic DevOps from one prompt to production")
  .version("0.1.0")
  .option("--json", "Output as structured JSON (stdout)")
  .option("-q, --quiet", "Output bare values only")
  .option("--timeout <seconds>", "API request timeout in seconds", "30");

program.addCommand(loginCommand());
program.addCommand(servicesCommand());
program.addCommand(deployCommand());
program.addCommand(pushCommand());
program.addCommand(envCommand());
program.addCommand(logsCommand());
program.addCommand(planCommand());
program.addCommand(rollbackCommand());
program.addCommand(statusCommand());
program.addCommand(projectsCommand());
program.addCommand(doctorCommand());
program.addCommand(whoamiCommand());
program.addCommand(capabilitiesCommand());
program.addCommand(installCommand());
program.addCommand(upgradeCommand());
program.addCommand(uninstallCommand());

program.parse();
