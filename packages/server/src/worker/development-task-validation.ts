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

type ExecRunner = typeof execStreaming;

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

export async function runDevelopmentTaskValidation(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  commands: string[];
  onLog: OnLog;
  sandbox?: HostDockerCodexSandbox;
  execRunner?: ExecRunner;
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

  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  await chmod(logPath, 0o600).catch(() => undefined);

  try {
    const execRunner = input.execRunner ?? execStreaming;
    for (const command of input.commands) {
      const onLog: OnLog = (line) => {
        writeLogLine(logStream, command, line);
        input.onLog(line);
      };
      const execution = input.sandbox
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
      if (
        input.sandbox &&
        (result.signal || (input.sandbox.retainOnFailure && result.exitCode === 0))
      ) {
        const cleanup = buildHostDockerCleanupExecution(input.sandbox.containerName);
        await execRunner(cleanup.command, cleanup.args, cleanup.cwd, onLog).catch(() => undefined);
      }
      if (result.exitCode !== 0) {
        return {
          status: "failed",
          commands: input.commands,
          failedCommand: command,
          exitCode: result.exitCode,
          logPath,
          errorMessage: result.signal
            ? `Validation command terminated by signal ${result.signal}: ${command}`
            : `Validation command failed with exit code ${result.exitCode}: ${command}`
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
