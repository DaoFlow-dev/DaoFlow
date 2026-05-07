import { chmod, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { execStreaming, type LogLine, type OnLog } from "./docker-exec-shared";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  buildHostDockerCleanupExecution,
  buildHostDockerCodexExecution,
  type HostDockerCodexSandbox
} from "./development-task-host-docker";

type ExecRunner = typeof execStreaming;

export interface DevelopmentTaskCodexExecutionResult {
  status: "ok" | "failed";
  exitCode: number;
  logPath: string;
  errorMessage?: string;
}

function joinWorkspacePath(parent: string, child: string) {
  const nextPath = path.join(parent, child);
  const relative = path.relative(parent, nextPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Codex execution log path must stay inside the logs directory.");
  }

  return nextPath;
}

function writeLogLine(stream: NodeJS.WritableStream, line: LogLine) {
  stream.write(
    `${JSON.stringify({
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

export async function executeDevelopmentTaskCodex(input: {
  plan: DevelopmentTaskCodexPlan;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  onLog: OnLog;
  sandbox?: HostDockerCodexSandbox;
  execRunner?: ExecRunner;
}): Promise<DevelopmentTaskCodexExecutionResult> {
  await mkdir(input.workspace.logsPath, { recursive: true });
  const logPath = joinWorkspacePath(input.workspace.logsPath, "codex-exec.jsonl");
  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  await chmod(logPath, 0o600).catch(() => undefined);

  const onLog: OnLog = (line) => {
    writeLogLine(logStream, line);
    input.onLog(line);
  };

  try {
    const execRunner = input.execRunner ?? execStreaming;
    const execution = input.sandbox
      ? buildHostDockerCodexExecution({
          plan: input.plan,
          workspace: input.workspace,
          sandbox: input.sandbox
        })
      : {
          command: input.plan.command,
          args: input.plan.args,
          cwd: input.workspace.repoPath,
          env: input.plan.env,
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
      : await execRunner(execution.command, execution.args, execution.cwd, onLog, execution.env);

    const shouldCleanupSandbox =
      input.sandbox?.retainOnFailure === true
        ? result.exitCode === 0 && !result.signal
        : Boolean(input.sandbox);
    if (input.sandbox && shouldCleanupSandbox) {
      const cleanup = buildHostDockerCleanupExecution(input.sandbox.containerName);
      await execRunner(cleanup.command, cleanup.args, cleanup.cwd, onLog).catch(() => undefined);
    }

    if (result.exitCode !== 0) {
      return {
        status: "failed",
        exitCode: result.exitCode,
        logPath,
        errorMessage: result.signal
          ? `Codex terminated by signal ${result.signal}`
          : `Codex exited with code ${result.exitCode}`
      };
    }

    return {
      status: "ok",
      exitCode: 0,
      logPath
    };
  } finally {
    await closeLogStream(logStream);
  }
}
