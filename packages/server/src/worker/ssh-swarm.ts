import type { OnLog } from "./docker-executor";
import {
  COMPOSE_COMMAND_ENV_ALLOWLIST,
  formatRemoteComposeExecutionEnvSummary
} from "./compose-command-env";
import {
  parseSwarmServiceLsOutput,
  parseSwarmTaskPsOutput,
  type SwarmServiceStatus,
  type SwarmTaskStatus
} from "./swarm-health";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

function buildRemoteComposeEnvPrefix(): string {
  const preserved = COMPOSE_COMMAND_ENV_ALLOWLIST.map((key) => `${key}="\${${key}:-}" `).join("");
  return `env -i DOCKER_CLI_HINTS=false ${preserved}`.trimEnd();
}

function buildRemoteStackDeployCommand(input: {
  composeFile: string;
  stackName: string;
  workDir: string;
  envExportFile?: string;
}): string {
  const exportPrefix = input.envExportFile
    ? `set -a && . ${shellQuote(input.envExportFile)} && set +a && `
    : "";

  return (
    `cd ${shellQuote(input.workDir)} && ${buildRemoteComposeEnvPrefix()} sh -lc ` +
    shellQuote(
      `${exportPrefix}docker stack deploy --compose-file ${shellQuote(input.composeFile)} --prune ${shellQuote(input.stackName)}`
    )
  );
}

function buildRemoteStackCommand(input: { workDir: string; subcommand: string }): string {
  return `cd ${shellQuote(input.workDir)} && ${buildRemoteComposeEnvPrefix()} sh -lc ${shellQuote(input.subcommand)}`;
}

export async function remoteDockerStackDeploy(
  target: SSHTarget,
  composeFile: string,
  stackName: string,
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

  const result = await exec(
    target,
    buildRemoteStackDeployCommand({
      composeFile,
      stackName,
      workDir,
      envExportFile
    }),
    onLog
  );
  return { exitCode: result.exitCode };
}

export async function remoteDockerStackRemove(
  target: SSHTarget,
  stackName: string,
  workDir: string,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(),
    timestamp: new Date()
  });

  const result = await exec(
    target,
    buildRemoteStackCommand({
      workDir,
      subcommand: `docker stack rm ${shellQuote(stackName)}`
    }),
    onLog
  );
  return { exitCode: result.exitCode };
}

export async function remoteDockerStackServices(
  target: SSHTarget,
  stackName: string,
  workDir: string,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number; services: SwarmServiceStatus[] }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    buildRemoteStackCommand({
      workDir,
      subcommand: `docker stack services ${shellQuote(stackName)} --format json`
    }),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    }
  );

  return {
    exitCode: result.exitCode,
    services: result.exitCode === 0 ? parseSwarmServiceLsOutput(stdoutLines.join("\n")) : []
  };
}

export async function remoteDockerStackPs(
  target: SSHTarget,
  stackName: string,
  workDir: string,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number; tasks: SwarmTaskStatus[] }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    buildRemoteStackCommand({
      workDir,
      subcommand: `docker stack ps ${shellQuote(stackName)} --filter desired-state=running --format json`
    }),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    }
  );

  return {
    exitCode: result.exitCode,
    tasks: result.exitCode === 0 ? parseSwarmTaskPsOutput(stdoutLines.join("\n")) : []
  };
}

function parseTaskNetworkAddresses(stdoutLines: string[]): string[] {
  return stdoutLines
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\/\d+$/, ""));
}

export async function remoteDockerInspectSwarmTaskNetworkAddresses(
  target: SSHTarget,
  taskId: string,
  workDir: string,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number; addresses: string[] }> {
  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    buildRemoteStackCommand({
      workDir,
      subcommand:
        `docker inspect --type task --format ` +
        `${shellQuote("{{range .NetworksAttachments}}{{range .Addresses}}{{println .}}{{end}}{{end}}")} ` +
        shellQuote(taskId)
    }),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    }
  );

  return {
    exitCode: result.exitCode,
    addresses: result.exitCode === 0 ? parseTaskNetworkAddresses(stdoutLines) : []
  };
}
