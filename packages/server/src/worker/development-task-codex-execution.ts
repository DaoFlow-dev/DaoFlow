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
import {
  runSandbankBoxLiteCommand,
  type SandbankBoxLiteCodexSandbox
} from "./development-task-sandbank-boxlite";

type ExecRunner = typeof execStreaming;
type SandbankBoxLiteRunner = typeof runSandbankBoxLiteCommand;
type DevelopmentTaskCodexSandbox = HostDockerCodexSandbox | SandbankBoxLiteCodexSandbox;
type ExecStreamingResult = Awaited<ReturnType<ExecRunner>>;

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

function appendRecentLogLine(lines: LogLine[], line: LogLine) {
  lines.push(line);
  if (lines.length > 50) {
    lines.shift();
  }
}

function summarizeHostDockerFailure(lines: LogLine[]) {
  const output = lines
    .map((line) => line.message)
    .join("\n")
    .toLowerCase();

  if (output.includes("no space left on device") || output.includes("not enough space")) {
    return [
      "Host Docker sandbox failed because the Docker host is out of disk space.",
      "Free space or prune unused Docker images/build cache on the runner host, then retry."
    ].join(" ");
  }

  if (
    output.includes("cannot connect to the docker daemon") ||
    output.includes("error during connect")
  ) {
    return "Host Docker sandbox could not reach the Docker daemon. Check Docker service health and runner DOCKER_HOST settings.";
  }

  if (
    output.includes("pull access denied") ||
    output.includes("manifest unknown") ||
    output.includes("repository does not exist")
  ) {
    return "Host Docker sandbox could not pull the runner image. Check the runner image name, tag, and registry permissions.";
  }

  if (output.includes("exec format error")) {
    return "Host Docker sandbox runner image architecture does not match the Docker host.";
  }

  return undefined;
}

function buildFailureMessage(input: {
  result: ExecStreamingResult;
  sandbox?: DevelopmentTaskCodexSandbox;
  recentLogLines: LogLine[];
}) {
  if (input.result.signal) {
    return `Codex terminated by signal ${input.result.signal}`;
  }

  const hostDockerMessage =
    input.sandbox?.provider === "host_docker"
      ? summarizeHostDockerFailure(input.recentLogLines)
      : undefined;

  return hostDockerMessage ?? `Codex exited with code ${input.result.exitCode}`;
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
  sandbox?: DevelopmentTaskCodexSandbox;
  execRunner?: ExecRunner;
  sandbankBoxLiteRunner?: SandbankBoxLiteRunner;
}): Promise<DevelopmentTaskCodexExecutionResult> {
  await mkdir(input.workspace.logsPath, { recursive: true });
  const logPath = joinWorkspacePath(input.workspace.logsPath, "codex-exec.jsonl");
  const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  await chmod(logPath, 0o600).catch(() => undefined);

  const recentLogLines: LogLine[] = [];
  const onLog: OnLog = (line) => {
    appendRecentLogLine(recentLogLines, line);
    writeLogLine(logStream, line);
    input.onLog(line);
  };

  try {
    const execRunner = input.execRunner ?? execStreaming;
    const execution =
      input.sandbox?.provider === "host_docker"
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
    const result =
      input.sandbox?.provider === "sandbank_boxlite"
        ? await (input.sandbankBoxLiteRunner ?? runSandbankBoxLiteCommand)({
            workspace: input.workspace,
            sandbox: input.sandbox,
            command: input.plan.command,
            args: input.plan.args,
            env: input.plan.env,
            onLog
          })
        : execution.options
          ? await execRunner(
              execution.command,
              execution.args,
              execution.cwd,
              onLog,
              execution.env,
              execution.options
            )
          : await execRunner(
              execution.command,
              execution.args,
              execution.cwd,
              onLog,
              execution.env
            );

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
        exitCode: result.exitCode,
        logPath,
        errorMessage: buildFailureMessage({
          result,
          sandbox: input.sandbox,
          recentLogLines
        })
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
