import path from "node:path";
import { dockerCommand } from "./command-env";
import { STAGING_DIR, type ExecStreamingOptions } from "./docker-exec-shared";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";

export interface HostDockerCodexSandbox {
  containerName: string;
  image: string;
  cpuLimit: number;
  memoryLimitMb: number;
  timeoutMinutes: number;
  networkPolicy: string;
}

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
];

function safeContainerName(value: string) {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^-+/, "");
  return safe.slice(0, 120) || "daoflow-development-task";
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildHostDockerSandboxFromRun(input: {
  runId: string;
  metadata: unknown;
}): HostDockerCodexSandbox {
  const metadata = readRecord(input.metadata);
  const image =
    typeof metadata.image === "string" && metadata.image.trim()
      ? metadata.image.trim()
      : "ghcr.io/daoflow/codex-runner:latest";

  return {
    containerName: safeContainerName(`daoflow-devtask-${input.runId}`),
    image,
    cpuLimit: positiveNumber(metadata.cpuLimit, 2),
    memoryLimitMb: positiveInteger(metadata.memoryLimitMb, 4096),
    timeoutMinutes: positiveInteger(metadata.timeoutMinutes, 60),
    networkPolicy:
      typeof metadata.networkPolicy === "string" && metadata.networkPolicy.trim()
        ? metadata.networkPolicy.trim()
        : "default-egress"
  };
}

function assertWorkspacePath(parent: string, child: string) {
  const relative = path.relative(parent, child);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Host Docker sandbox paths must stay inside the run workspace.");
  }
}

function runWorkspaceRoot(workspace: PreparedDevelopmentTaskCodexWorkspace) {
  const root = path.dirname(workspace.repoPath);
  assertWorkspacePath(root, workspace.repoPath);
  assertWorkspacePath(root, workspace.codexHomePath);
  assertWorkspacePath(root, workspace.logsPath);
  assertWorkspacePath(root, workspace.artifactsPath);
  return root;
}

function appendNetworkArgs(args: string[], networkPolicy: string) {
  if (["none", "no-network", "disabled"].includes(networkPolicy)) {
    args.push("--network", "none");
  }
}

function appendEnvArgs(args: string[], env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }
  for (const key of PROVIDER_ENV_KEYS) {
    if (process.env[key] !== undefined && env[key] === undefined) {
      args.push("--env", key);
    }
  }
}

export function buildHostDockerCodexExecution(input: {
  plan: DevelopmentTaskCodexPlan;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  sandbox: HostDockerCodexSandbox;
}) {
  return buildHostDockerCommandExecution({
    workspace: input.workspace,
    sandbox: input.sandbox,
    command: input.plan.command,
    args: input.plan.args,
    env: input.plan.env
  });
}

export function buildHostDockerCommandExecution(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  sandbox: HostDockerCodexSandbox;
  command: string;
  args: string[];
  env?: Record<string, string>;
}): {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string> | undefined;
  options: ExecStreamingOptions;
} {
  const root = runWorkspaceRoot(input.workspace);
  const args = [
    "run",
    "--rm",
    "--name",
    input.sandbox.containerName,
    "--cpus",
    String(input.sandbox.cpuLimit),
    "--memory",
    `${input.sandbox.memoryLimitMb}m`,
    "--pids-limit",
    "512",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--volume",
    `${root}:${root}`,
    "--workdir",
    input.workspace.repoPath
  ];

  appendNetworkArgs(args, input.sandbox.networkPolicy);
  appendEnvArgs(args, input.env ?? {});
  args.push(input.sandbox.image, input.command, ...input.args);

  return {
    command: dockerCommand,
    args,
    cwd: STAGING_DIR,
    env: undefined,
    options: {
      timeoutMs: input.sandbox.timeoutMinutes * 60_000
    }
  };
}

export function buildHostDockerCleanupExecution(containerName: string) {
  return {
    command: dockerCommand,
    args: ["rm", "-f", containerName],
    cwd: STAGING_DIR
  };
}
