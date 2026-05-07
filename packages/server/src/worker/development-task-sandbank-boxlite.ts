import { BoxLiteAdapter } from "@sandbank.dev/boxlite";
import { createProvider } from "@sandbank.dev/core";
import type { Sandbox } from "@sandbank.dev/core";
import type { LogLine, OnLog } from "./docker-exec-shared";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  createWorkspaceArchive,
  developmentTaskWorkspaceRoot,
  restoreWorkspaceArchive
} from "./development-task-sandbox-archive-sync";

export interface SandbankBoxLiteCodexSandbox {
  provider: "sandbank_boxlite";
  sandboxName: string;
  image: string;
  cpuLimit: number;
  memoryLimitMb: number;
  diskSizeGb: number;
  timeoutMinutes: number;
  retainOnFailure: boolean;
  mode: "local" | "remote";
  apiUrl?: string;
  apiTokenEnvKey: string;
  clientIdEnvKey: string;
  clientSecretEnvKey: string;
  prefix?: string;
  pythonPath?: string;
  boxliteHome?: string;
}

type SandbankProvider = ReturnType<typeof createProvider>;

export interface SandbankBoxLiteCommandSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  onLog?: OnLog;
  label?: string;
}

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
];

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readEnvKey(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Z_][A-Z0-9_]*$/.test(value) ? value : fallback;
}

function safeSandboxName(value: string) {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^-+/, "");
  return safe.slice(0, 120) || "daoflow-boxlite-devtask";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandLine(command: string, args: string[]) {
  return [command, ...args].map(shellQuote).join(" ");
}

function commandLabel(command: SandbankBoxLiteCommandSpec, index: number) {
  return command.label ?? `sandbox command ${index + 1}`;
}

function sandboxUserName(sandbox: Sandbox) {
  const name = sandbox.user?.name;
  return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : "daoflow";
}

function collectProviderEnv(env: Record<string, string> = {}) {
  const next = { ...env };
  for (const key of PROVIDER_ENV_KEYS) {
    if (process.env[key] !== undefined && next[key] === undefined) {
      next[key] = process.env[key]!;
    }
  }
  return next;
}

function createBoxLiteProvider(sandbox: SandbankBoxLiteCodexSandbox): SandbankProvider {
  const adapter =
    sandbox.mode === "remote"
      ? new BoxLiteAdapter({
          apiUrl: sandbox.apiUrl ?? "http://127.0.0.1:9090",
          apiToken: process.env[sandbox.apiTokenEnvKey],
          clientId: process.env[sandbox.clientIdEnvKey],
          clientSecret: process.env[sandbox.clientSecretEnvKey],
          prefix: sandbox.prefix
        })
      : new BoxLiteAdapter({
          mode: "local",
          pythonPath: sandbox.pythonPath,
          boxliteHome: sandbox.boxliteHome
        });

  return createProvider(adapter);
}

function logBufferedOutput(onLog: OnLog, stream: LogLine["stream"], output: string) {
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    onLog({ stream, message: line, timestamp: new Date() });
  }
}

async function destroyProviderSandbox(provider: SandbankProvider, sandbox: Sandbox, onLog: OnLog) {
  await provider.destroy(sandbox.id).catch((err: unknown) => {
    onLog({
      stream: "stderr",
      message: `BoxLite sandbox cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date()
    });
  });
}

export function buildSandbankBoxLiteSandboxFromRun(input: {
  runId: string;
  metadata: unknown;
}): SandbankBoxLiteCodexSandbox {
  const metadata = readRecord(input.metadata);
  const apiUrl = readString(metadata.boxLiteApiUrl ?? metadata.boxliteApiUrl);
  const mode = metadata.boxLiteMode === "remote" || apiUrl ? "remote" : "local";

  return {
    provider: "sandbank_boxlite",
    sandboxName: safeSandboxName(`daoflow-boxlite-devtask-${input.runId}`),
    image: readString(metadata.image) ?? "ubuntu:24.04",
    cpuLimit: positiveNumber(metadata.cpuLimit, 2),
    memoryLimitMb: positiveInteger(metadata.memoryLimitMb, 4096),
    diskSizeGb: positiveInteger(metadata.diskSizeGb, 20),
    timeoutMinutes: positiveInteger(metadata.timeoutMinutes, 60),
    retainOnFailure: metadata.retainOnFailure === true || metadata.sandboxRetainOnFailure === true,
    mode,
    apiUrl,
    apiTokenEnvKey: readEnvKey(metadata.boxLiteApiTokenEnvKey, "BOXLITE_API_TOKEN"),
    clientIdEnvKey: readEnvKey(metadata.boxLiteClientIdEnvKey, "BOXLITE_CLIENT_ID"),
    clientSecretEnvKey: readEnvKey(metadata.boxLiteClientSecretEnvKey, "BOXLITE_CLIENT_SECRET"),
    prefix: readString(metadata.boxLitePrefix),
    pythonPath: readString(metadata.boxLitePythonPath),
    boxliteHome: readString(metadata.boxLiteHome)
  };
}

export async function runSandbankBoxLiteCommand(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  sandbox: SandbankBoxLiteCodexSandbox;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onLog: OnLog;
  provider?: SandbankProvider;
}) {
  return runSandbankBoxLiteCommands({
    workspace: input.workspace,
    sandbox: input.sandbox,
    commands: [
      {
        command: input.command,
        args: input.args,
        env: input.env,
        onLog: input.onLog
      }
    ],
    onLog: input.onLog,
    provider: input.provider
  });
}

export async function runSandbankBoxLiteCommands(input: {
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  sandbox: SandbankBoxLiteCodexSandbox;
  commands: SandbankBoxLiteCommandSpec[];
  onLog: OnLog;
  provider?: SandbankProvider;
}) {
  const root = developmentTaskWorkspaceRoot(input.workspace);
  const provider = input.provider ?? createBoxLiteProvider(input.sandbox);
  const env = input.commands.reduce<Record<string, string>>(
    (next, command) => ({ ...next, ...(command.env ?? {}) }),
    {}
  );
  const box = await provider.create({
    image: input.sandbox.image,
    env: collectProviderEnv(env),
    resources: {
      cpu: input.sandbox.cpuLimit,
      memory: input.sandbox.memoryLimitMb,
      disk: input.sandbox.diskSizeGb
    },
    timeout: Math.min(input.sandbox.timeoutMinutes * 60, 300),
    user: { name: "daoflow", sudo: true }
  });

  let exitCode = 1;
  const signal: NodeJS.Signals | null = null;
  let failedCommand: string | undefined;
  try {
    const user = sandboxUserName(box);
    await box.exec(
      `mkdir -p ${shellQuote(root)} && chown -R ${shellQuote(user)} ${shellQuote(root)}`,
      {
        asRoot: true,
        timeout: 30_000
      }
    );
    await box.uploadArchive(await createWorkspaceArchive({ workspace: input.workspace }), root);
    for (const [index, command] of input.commands.entries()) {
      const result = await box.exec(commandLine(command.command, command.args), {
        cwd: input.workspace.repoPath,
        timeout: input.sandbox.timeoutMinutes * 60_000
      });
      const onLog = command.onLog ?? input.onLog;
      exitCode = result.exitCode;
      logBufferedOutput(onLog, "stdout", result.stdout);
      logBufferedOutput(onLog, "stderr", result.stderr);
      if (result.exitCode !== 0) {
        failedCommand = commandLabel(command, index);
        break;
      }
    }
    await restoreWorkspaceArchive({
      workspace: input.workspace,
      stream: await box.downloadArchive(root)
    });
  } finally {
    if (!input.sandbox.retainOnFailure || exitCode === 0) {
      await destroyProviderSandbox(provider, box, input.onLog);
    }
  }

  return { exitCode, signal, failedCommand };
}
