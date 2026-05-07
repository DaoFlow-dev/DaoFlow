import { chmod, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { execStreaming, type LogLine, type OnLog } from "./docker-exec-shared";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  buildHostDockerCleanupExecution,
  buildHostDockerCommandExecution,
  type HostDockerCodexSandbox
} from "./development-task-host-docker";
import {
  runSandbankBoxLiteCommands,
  type SandbankBoxLiteCodexSandbox
} from "./development-task-sandbank-boxlite";

type ExecRunner = typeof execStreaming;
type SandbankBoxLiteCommandsRunner = typeof runSandbankBoxLiteCommands;
type DevelopmentTaskValidationSandbox = HostDockerCodexSandbox | SandbankBoxLiteCodexSandbox;

export interface DevelopmentTaskValidationResult {
  status: "ok" | "failed" | "skipped";
  commands: string[];
  failedCommand?: string;
  exitCode?: number;
  logPath: string;
  errorMessage?: string;
}

function joinWorkspacePath(parent: string, child: string) {
  const nextPath = path.join(parent, child);
  const relative = path.relative(parent, nextPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Validation log path must stay inside the logs directory.");
  }

  return nextPath;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function writeLogLine(stream: NodeJS.WritableStream, command: string, line: LogLine) {
  stream.write(
    `${JSON.stringify({
      command,
      stream: line.stream,
      message: line.message,
      timestamp: line.timestamp.toISOString()
    })}\n`
  );
}

function closeLogStream(stream: NodeJS.WritableStream) {
  return new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

export function readDevelopmentTaskValidationCommands(metadata: Record<string, unknown>) {
  return readStringArray(metadata.validationCommands);
}

export function readDevelopmentTaskAllowedCommands(metadata: Record<string, unknown>) {
  return readStringArray(metadata.allowedCommands);
}

function findDisallowedCommand(commands: string[], allowedCommands: string[]) {
  if (allowedCommands.length === 0) {
    return commands.length > 0 ? { index: 0 } : null;
  }

  const allowed = new Set(allowedCommands.map((command) => command.trim()));
  const index = commands.findIndex((command) => !allowed.has(command.trim()));
  return index >= 0 ? { index } : null;
}

function validationCommandLabel(index: number) {
  return `validation command ${index + 1}`;
}

export async function runDevelopmentTaskValidation(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  commands: string[];
  allowedCommands?: string[];
  onLog: OnLog;
  sandbox?: DevelopmentTaskValidationSandbox;
  execRunner?: ExecRunner;
  sandbankBoxLiteCommandsRunner?: SandbankBoxLiteCommandsRunner;
}): Promise<DevelopmentTaskValidationResult> {
  await mkdir(input.workspace.logsPath, { recursive: true });
  const logPath = joinWorkspacePath(input.workspace.logsPath, "validation.jsonl");

  if (input.commands.length === 0) {
    return {
      status: "skipped",
      commands: [],
      logPath,
      errorMessage: "No validation commands are configured for this runner."
    };
  }

  const disallowedCommand = findDisallowedCommand(input.commands, input.allowedCommands ?? []);
  if (disallowedCommand) {
    const failedCommand = validationCommandLabel(disallowedCommand.index);
    return {
      status: "failed",
      commands: input.commands,
      failedCommand,
      logPath,
      errorMessage: `Validation command is not allowed by the runner policy: ${failedCommand}`
    };
  }

  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  await chmod(logPath, 0o600).catch(() => undefined);

  try {
    const execRunner = input.execRunner ?? execStreaming;
    if (input.sandbox?.provider === "sandbank_boxlite") {
      const result = await (input.sandbankBoxLiteCommandsRunner ?? runSandbankBoxLiteCommands)({
        workspace: input.workspace,
        sandbox: input.sandbox,
        commands: input.commands.map((command, index) => ({
          command: "sh",
          args: ["-lc", command],
          label: validationCommandLabel(index),
          onLog: (line) => {
            writeLogLine(logStream, command, line);
            input.onLog(line);
          }
        })),
        onLog: input.onLog
      });

      if (result.exitCode !== 0) {
        const failedCommand = result.failedCommand ?? validationCommandLabel(0);
        return {
          status: "failed",
          commands: input.commands,
          failedCommand,
          exitCode: result.exitCode,
          logPath,
          errorMessage: `Validation command failed with exit code ${result.exitCode}: ${failedCommand}`
        };
      }

      return {
        status: "ok",
        commands: input.commands,
        logPath
      };
    }

    for (const [index, command] of input.commands.entries()) {
      const failedCommand = validationCommandLabel(index);
      const onLog: OnLog = (line) => {
        writeLogLine(logStream, command, line);
        input.onLog(line);
      };
      const execution =
        input.sandbox?.provider === "host_docker"
          ? buildHostDockerCommandExecution({
              workspace: input.workspace,
              sandbox: input.sandbox,
              command: "sh",
              args: ["-lc", command]
            })
          : {
              command: "sh",
              args: ["-lc", command],
              cwd: input.workspace.repoPath,
              env: undefined,
              options: undefined
            };
      const result = execution.options
        ? await execRunner(
            execution.command,
            execution.args,
            execution.cwd,
            onLog,
            execution.env,
            execution.options
          )
        : await execRunner(execution.command, execution.args, execution.cwd, onLog);
      const shouldCleanupSandbox =
        input.sandbox?.provider === "host_docker" && input.sandbox.retainOnFailure === true
          ? result.exitCode === 0 && !result.signal
          : input.sandbox?.provider === "host_docker";
      if (input.sandbox?.provider === "host_docker" && shouldCleanupSandbox) {
        const cleanup = buildHostDockerCleanupExecution(input.sandbox.containerName);
        await execRunner(cleanup.command, cleanup.args, cleanup.cwd, onLog).catch(() => undefined);
      }
      if (result.exitCode !== 0) {
        return {
          status: "failed",
          commands: input.commands,
          failedCommand,
          exitCode: result.exitCode,
          logPath,
          errorMessage: result.signal
            ? `Validation command terminated by signal ${result.signal}: ${failedCommand}`
            : `Validation command failed with exit code ${result.exitCode}: ${failedCommand}`
        };
      }
    }

    return {
      status: "ok",
      commands: input.commands,
      logPath
    };
  } finally {
    await closeLogStream(logStream);
  }
}
