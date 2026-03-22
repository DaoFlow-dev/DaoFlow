import type { ContainerRegistryCredential } from "../container-registries-shared";
import type { OnLog } from "./docker-executor";
import {
  COMPOSE_COMMAND_ENV_ALLOWLIST,
  formatRemoteComposeExecutionEnvSummary
} from "./compose-command-env";
import { buildRegistryAwareShellCommand } from "./registry-auth";
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
  registryCredentials?: ContainerRegistryCredential[];
}): { preview: string; stdin: string } {
  const dockerStackDeployCommand = buildRegistryAwareShellCommand(
    `${buildRemoteComposeEnvPrefix()} docker stack deploy --compose-file ${shellQuote(input.composeFile)} --prune ${
      input.registryCredentials?.length ? "--with-registry-auth " : ""
    }${shellQuote(input.stackName)}`,
    input.registryCredentials ?? []
  );

  const scriptLines = ["set -e", `cd ${shellQuote(input.workDir)}`];
  if (input.envExportFile) {
    scriptLines.push(`set -a; . ${shellQuote(input.envExportFile)}; set +a`);
  }
  scriptLines.push(dockerStackDeployCommand);

  return {
    preview: `docker stack deploy --compose-file ${input.composeFile} --prune ${
      input.registryCredentials?.length ? "--with-registry-auth " : ""
    }${input.stackName}`,
    stdin: scriptLines.join("\n")
  };
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
  registryCredentials: ContainerRegistryCredential[] = [],
  exec: typeof execRemote = execRemote
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: formatRemoteComposeExecutionEnvSummary(envFile),
    timestamp: new Date()
  });

  const execution = buildRemoteStackDeployCommand({
    composeFile,
    stackName,
    workDir,
    envExportFile,
    registryCredentials
  });
  const result = await exec(target, "sh", onLog, {
    preview: execution.preview,
    stdin: execution.stdin
  });
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
