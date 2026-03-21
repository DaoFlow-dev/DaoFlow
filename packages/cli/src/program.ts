import { Command } from "commander";
import chalk from "chalk";
import { CLI_VERSION } from "./version";
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
import { updateCommand } from "./commands/update";
import { backupCommand } from "./commands/backup";
import { tokenCommand } from "./commands/token";
import { diffCommand } from "./commands/diff";
import { cancelCommand } from "./commands/cancel";
import { serverCommand } from "./commands/server";
import { volumesCommand } from "./commands/volumes";
import { notificationsCommand } from "./commands/notifications";
import { registerConfigCommand } from "./commands/config";
import { emitJsonError, getErrorMessage } from "./command-helpers";

function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("daoflow")
    .description("DaoFlow CLI — the agentic platform to host deterministic systems")
    .version(CLI_VERSION)
    .option("--json", "Output as structured JSON (stdout)")
    .option("-q, --quiet", "Output bare values only")
    .option("--timeout <seconds>", "API request timeout in seconds", "30")
    .option("--idempotency-key <key>", "Replay-safe key for write commands");

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
  program.addCommand(backupCommand());
  program.addCommand(tokenCommand());
  program.addCommand(diffCommand());
  program.addCommand(cancelCommand());
  program.addCommand(serverCommand());
  program.addCommand(volumesCommand());
  program.addCommand(notificationsCommand());
  program.addCommand(updateCommand());
  registerConfigCommand(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    const message = getErrorMessage(error);
    if (wantsJson(argv)) {
      emitJsonError(message, "CLI_ERROR");
    } else {
      console.error(chalk.red(`Error: ${message}`));
    }
    process.exit(1);
  }
}
