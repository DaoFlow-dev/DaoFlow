import { Command, type ParseOptions } from "commander";
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
import { auditCommand } from "./commands/audit";
import { approvalsCommand } from "./commands/approvals";
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
import { templatesCommand } from "./commands/templates";
import { registerConfigCommand } from "./commands/config";
import { emitJsonError, getErrorMessage } from "./command-helpers";

function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

function normalizeServicesListInvocation(
  argv: readonly string[],
  from: "node" | "electron" | "user" = "node"
): string[] {
  const normalized = [...argv];
  const startIndex = from === "user" ? 0 : 2;
  let commandIndex = -1;

  for (let index = startIndex; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg || arg === "--") {
      break;
    }

    if (!arg.startsWith("-")) {
      commandIndex = index;
      break;
    }

    if (arg === "--timeout" || arg === "--idempotency-key") {
      index += 1;
    }
  }

  if (commandIndex === -1 || normalized[commandIndex] !== "services") {
    return normalized;
  }

  const nextArg = normalized[commandIndex + 1];
  if (nextArg === undefined || nextArg.startsWith("-")) {
    normalized.splice(commandIndex + 1, 0, "list");
  }

  return normalized;
}

function readProcessExitCode(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = error.message.match(/^process\.exit\((\d+)\)$/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1] ?? "", 10);
}

function wantsTopLevelVersion(argv: readonly string[]): boolean {
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === "--") {
      return false;
    }

    if (!arg.startsWith("-")) {
      return false;
    }

    if (arg === "--version" || arg === "--cli-version" || arg === "-V") {
      return true;
    }

    if (arg === "--timeout" || arg === "--idempotency-key") {
      index += 1;
      continue;
    }

    if (arg === "--json" || arg === "--quiet" || arg === "-q") {
      continue;
    }

    return false;
  }

  return false;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("daoflow")
    .description("DaoFlow CLI — the agentic platform to host deterministic systems")
    .version(CLI_VERSION, "-V, --cli-version", "Output CLI version")
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
  program.addCommand(auditCommand());
  program.addCommand(approvalsCommand());
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
  program.addCommand(templatesCommand());
  program.addCommand(updateCommand());
  registerConfigCommand(program);

  const originalParseAsync = program.parseAsync.bind(program);
  program.parseAsync = async function parseAsyncWithServicesNormalization(
    argv?: readonly string[],
    parseOptions?: ParseOptions
  ) {
    const normalizedArgv =
      argv !== undefined
        ? normalizeServicesListInvocation(argv, parseOptions?.from ?? "node")
        : argv;
    return await originalParseAsync(normalizedArgv, parseOptions);
  } as typeof program.parseAsync;

  const originalParse = program.parse.bind(program);
  program.parse = function parseWithServicesNormalization(
    argv?: readonly string[],
    parseOptions?: ParseOptions
  ) {
    const normalizedArgv =
      argv !== undefined
        ? normalizeServicesListInvocation(argv, parseOptions?.from ?? "node")
        : argv;
    return originalParse(normalizedArgv, parseOptions);
  } as typeof program.parse;

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  if (wantsTopLevelVersion(argv)) {
    console.log(CLI_VERSION);
    return;
  }

  const program = createProgram();

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    const exitCode = readProcessExitCode(error);
    if (exitCode !== null) {
      process.exit(exitCode);
      return;
    }

    const message = getErrorMessage(error);
    if (wantsJson(argv)) {
      emitJsonError(message, "CLI_ERROR");
    } else {
      console.error(chalk.red(`Error: ${message}`));
    }
    process.exit(1);
  }
}
