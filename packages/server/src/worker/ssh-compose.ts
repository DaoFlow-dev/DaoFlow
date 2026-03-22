import type { ContainerRegistryCredential } from "../container-registries-shared";
import type { OnLog } from "./docker-executor";
import {
  COMPOSE_COMMAND_ENV_ALLOWLIST,
  formatRemoteComposeExecutionEnvSummary
} from "./compose-command-env";
import { parseComposePsOutput, type ComposeContainerStatus } from "./compose-health";
import { buildRegistryAwareShellCommand } from "./registry-auth";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

function buildRemoteComposeEnvPrefix(): string {
  const preserved = COMPOSE_COMMAND_ENV_ALLOWLIST.map((key) => `${key}="\${${key}:-}" `).join("");
  return `env -i DOCKER_CLI_HINTS=false ${preserved}`.trimEnd();
}

function buildRemoteComposeExecution(input: {
  composeFile: string;
  projectName: string;
  workDir: string;
  subcommand: string;
  envFile?: string;
  envExportFile?: string;
  serviceName?: string;
  buildMode?: boolean;
  registryCredentials?: ContainerRegistryCredential[];
}): { remoteCommand: string; preview: string; stdin: string } {
  const envFileArg = input.envFile ? ` --env-file ${shellQuote(input.envFile)}` : "";
  const serviceArg = input.serviceName ? ` ${shellQuote(input.serviceName)}` : "";
  const buildPrefix = input.buildMode ? "DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 " : "";
  const preview =
    `docker compose -f ${input.composeFile} -p ${input.projectName}` +
    `${input.envFile ? ` --env-file ${input.envFile}` : ""} ${input.subcommand}` +
    `${input.serviceName ? ` ${input.serviceName}` : ""}`;
  const dockerComposeCommand =
    `${buildRemoteComposeEnvPrefix()} ${buildPrefix}docker compose -f ${shellQuote(input.composeFile)} -p ` +
    `${shellQuote(input.projectName)}${envFileArg} ${input.subcommand}${serviceArg}`;
  const guardedDockerComposeCommand = buildRegistryAwareShellCommand(
    dockerComposeCommand,
    input.registryCredentials ?? []
  );

  const scriptLines = ["set -e", `cd ${shellQuote(input.workDir)}`];
  if (input.envExportFile) {
    scriptLines.push(`set -a; . ${shellQuote(input.envExportFile)}; set +a`);
  }
  scriptLines.push(guardedDockerComposeCommand);

  return {
    remoteCommand: "sh",
    preview,
    stdin: scriptLines.join("\n")
  };
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
  registryCredentials: ContainerRegistryCredential[] = [],
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
  const execution = buildRemoteComposeExecution({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand,
    serviceName,
    registryCredentials
  });
  const result = await exec(target, execution.remoteCommand, onLog, {
    preview: execution.preview,
    stdin: execution.stdin
  });
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
  registryCredentials: ContainerRegistryCredential[] = [],
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const subcommand = serviceName ? "build --with-dependencies" : "build";
  const execution = buildRemoteComposeExecution({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand,
    serviceName,
    buildMode: true,
    registryCredentials
  });
  const result = await exec(target, execution.remoteCommand, onLog, {
    preview: execution.preview,
    stdin: execution.stdin
  });
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
  registryCredentials: ContainerRegistryCredential[] = [],
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const execution = buildRemoteComposeExecution({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "up -d --remove-orphans",
    serviceName,
    registryCredentials
  });
  const result = await exec(target, execution.remoteCommand, onLog, {
    preview: execution.preview,
    stdin: execution.stdin
  });
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
  const execution = buildRemoteComposeExecution({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "ps --format json",
    serviceName
  });

  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    execution.remoteCommand,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    {
      preview: execution.preview,
      stdin: execution.stdin
    }
  );

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
  const execution = buildRemoteComposeExecution({
    composeFile,
    projectName,
    workDir,
    envFile,
    envExportFile,
    subcommand: "down"
  });
  const result = await exec(target, execution.remoteCommand, onLog, {
    preview: execution.preview,
    stdin: execution.stdin
  });
  return { exitCode: result.exitCode };
}
