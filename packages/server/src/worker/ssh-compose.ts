import type { OnLog } from "./docker-executor";
import {
  COMPOSE_COMMAND_ENV_ALLOWLIST,
  formatRemoteComposeExecutionEnvSummary
} from "./compose-command-env";
import { parseComposePsOutput, type ComposeContainerStatus } from "./compose-health";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

function buildRemoteComposeEnvPrefix(): string {
  const preserved = COMPOSE_COMMAND_ENV_ALLOWLIST.map((key) => `${key}="\${${key}:-}" `).join("");
  return `env -i DOCKER_CLI_HINTS=false ${preserved}`.trimEnd();
}

function buildRemoteComposeCommand(input: {
  composeFile: string;
  projectName: string;
  workDir: string;
  envFile?: string;
  envExportFile?: string;
  subcommand: string;
  serviceName?: string;
  buildMode?: boolean;
}): string {
  const envFileArg = input.envFile ? ` --env-file ${shellQuote(input.envFile)}` : "";
  const serviceArg = input.serviceName ? ` ${shellQuote(input.serviceName)}` : "";
  const buildPrefix = input.buildMode ? "DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 " : "";
  const exportPrefix = input.envExportFile
    ? `set -a && . ${shellQuote(input.envExportFile)} && set +a && `
    : "";
  const dockerComposeCommand =
    `${buildPrefix}docker compose -f ${shellQuote(input.composeFile)} -p ` +
    `${shellQuote(input.projectName)}${envFileArg} ${input.subcommand}${serviceArg}`;
  return (
    `cd ${shellQuote(input.workDir)} && ${buildRemoteComposeEnvPrefix()} sh -lc ` +
    shellQuote(`${exportPrefix}${dockerComposeCommand}`)
  );
}

export async function remoteDockerComposePull(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const subcommand = serviceName
    ? "pull --ignore-buildable --include-deps"
    : "pull --ignore-buildable";
  const cmd = buildRemoteComposeCommand({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand,
    serviceName
  });
  const result = await exec(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeBuild(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const subcommand = serviceName ? "build --with-dependencies" : "build";
  const cmd = buildRemoteComposeCommand({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand,
    serviceName,
    buildMode: true
  });
  const result = await exec(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeUp(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "up -d --remove-orphans",
    serviceName
  });
  const result = await exec(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposePs(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "ps --format json",
    serviceName
  });

  const stdoutLines: string[] = [];
  const result = await exec(target, cmd, (line) => {
    if (line.stream === "stdout") {
      stdoutLines.push(line.message);
      return;
    }

    onLog(line);
  });

  return {
    exitCode: result.exitCode,
    statuses: result.exitCode === 0 ? parseComposePsOutput(stdoutLines.join("\n")) : []
  };
}

export async function remoteDockerComposeDown(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "down"
  });
  const result = await exec(target, cmd, onLog);
  return { exitCode: result.exitCode };
}
