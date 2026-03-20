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

function normalizeComposeFiles(composeFiles: string | string[]): string[] {
  return Array.isArray(composeFiles) ? composeFiles : [composeFiles];
}

function buildRemoteComposeCommand(input: {
  composeFiles: string | string[];
  projectName: string;
  workDir: string;
  envFile?: string;
  envExportFile?: string;
  composeProfiles?: string[];
  subcommand: string;
  serviceName?: string;
  buildMode?: boolean;
}): string {
  const envFileArg = input.envFile ? ` --env-file ${shellQuote(input.envFile)}` : "";
  const composeFileArgs = normalizeComposeFiles(input.composeFiles)
    .map((composeFile) => ` -f ${shellQuote(composeFile)}`)
    .join("");
  const composeProfileArgs = (input.composeProfiles ?? [])
    .map((profile) => profile.trim())
    .filter((profile) => profile.length > 0)
    .map((profile) => ` --profile ${shellQuote(profile)}`)
    .join("");
  const serviceArg = input.serviceName ? ` ${shellQuote(input.serviceName)}` : "";
  const buildPrefix = input.buildMode ? "DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 " : "";
  const exportPrefix = input.envExportFile
    ? `set -a && . ${shellQuote(input.envExportFile)} && set +a && `
    : "";
  const dockerComposeCommand =
    `${buildPrefix}docker compose${composeFileArgs} -p ${shellQuote(input.projectName)}` +
    `${composeProfileArgs}${envFileArg} ${input.subcommand}${serviceArg}`;
  return (
    `cd ${shellQuote(input.workDir)} && ${buildRemoteComposeEnvPrefix()} sh -lc ` +
    shellQuote(`${exportPrefix}${dockerComposeCommand}`)
  );
}

export async function remoteDockerComposePull(
  target: SSHTarget,
  composeFiles: string | string[],
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  composeProfilesOrExec?: string[] | typeof execRemote,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  const composeProfiles = Array.isArray(composeProfilesOrExec) ? composeProfilesOrExec : undefined;
  const execImpl = typeof composeProfilesOrExec === "function" ? composeProfilesOrExec : exec;
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const subcommand = serviceName
    ? "pull --ignore-buildable --include-deps"
    : "pull --ignore-buildable";
  const cmd = buildRemoteComposeCommand({
    composeFiles,
    projectName,
    workDir,
    envFile,
    envExportFile,
    composeProfiles,
    subcommand,
    serviceName
  });
  const result = await execImpl(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeBuild(
  target: SSHTarget,
  composeFiles: string | string[],
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  composeProfilesOrExec?: string[] | typeof execRemote,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  const composeProfiles = Array.isArray(composeProfilesOrExec) ? composeProfilesOrExec : undefined;
  const execImpl = typeof composeProfilesOrExec === "function" ? composeProfilesOrExec : exec;
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const subcommand = serviceName ? "build --with-dependencies" : "build";
  const cmd = buildRemoteComposeCommand({
    composeFiles,
    projectName,
    workDir,
    envFile,
    envExportFile,
    composeProfiles,
    subcommand,
    serviceName,
    buildMode: true
  });
  const result = await execImpl(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeUp(
  target: SSHTarget,
  composeFiles: string | string[],
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  composeProfilesOrExec?: string[] | typeof execRemote,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  const composeProfiles = Array.isArray(composeProfilesOrExec) ? composeProfilesOrExec : undefined;
  const execImpl = typeof composeProfilesOrExec === "function" ? composeProfilesOrExec : exec;
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFiles,
    projectName,
    workDir,
    envFile,
    envExportFile,
    composeProfiles,
    subcommand: "up -d --remove-orphans",
    serviceName
  });
  const result = await execImpl(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposePs(
  target: SSHTarget,
  composeFiles: string | string[],
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  serviceName?: string,
  composeProfilesOrExec?: string[] | typeof execRemote,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  const composeProfiles = Array.isArray(composeProfilesOrExec) ? composeProfilesOrExec : undefined;
  const execImpl = typeof composeProfilesOrExec === "function" ? composeProfilesOrExec : exec;
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFiles,
    projectName,
    workDir,
    envFile,
    envExportFile,
    composeProfiles,
    subcommand: "ps --format json",
    serviceName
  });

  const stdoutLines: string[] = [];
  const result = await execImpl(target, cmd, (line) => {
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
  composeFiles: string | string[],
  projectName: string,
  workDir: string,
  onLog: OnLog,
  envFile?: string,
  envExportFile?: string,
  composeProfilesOrExec?: string[] | typeof execRemote,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  const composeProfiles = Array.isArray(composeProfilesOrExec) ? composeProfilesOrExec : undefined;
  const execImpl = typeof composeProfilesOrExec === "function" ? composeProfilesOrExec : exec;
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });
  const cmd = buildRemoteComposeCommand({
    composeFiles,
    projectName,
    workDir,
    envFile,
    envExportFile,
    composeProfiles,
    subcommand: "down"
  });
  const result = await execImpl(target, cmd, onLog);
  return { exitCode: result.exitCode };
}
