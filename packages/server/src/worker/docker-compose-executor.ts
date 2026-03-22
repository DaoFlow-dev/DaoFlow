import type { ContainerRegistryCredential } from "../container-registries-shared";
import { parseComposePsOutput, type ComposeContainerStatus } from "./compose-health";
import { formatComposeExecutionEnvSummary, prepareComposeCommandEnv } from "./compose-command-env";
import { dockerCommand } from "./command-env";
import { execStreaming, type OnLog } from "./docker-exec-shared";
import { wrapDockerCommandWithRegistryAuth } from "./registry-auth";

const COMPOSE_BUILD_ENV = {
  DOCKER_BUILDKIT: "1",
  COMPOSE_DOCKER_CLI_BUILD: "1"
} as const;

type ExecRunner = typeof execStreaming;

export async function dockerComposePull(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  registryCredentials: ContainerRegistryCredential[] = [],
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Pulling images for compose project ${projectName} (service: ${scopedServiceName})`
      : `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("pull", "--ignore-buildable");
  if (scopedServiceName) {
    args.push("--include-deps");
    args.push(scopedServiceName);
  }

  const execution = wrapDockerCommandWithRegistryAuth({
    command: dockerCommand,
    args,
    registries: registryCredentials
  });
  const execOptions =
    execution.stdin === undefined
      ? { inheritParentEnv: false }
      : { inheritParentEnv: false, stdin: execution.stdin };

  return execRunner(
    execution.command,
    execution.args,
    cwd,
    onLog,
    composeExecutionEnv.env,
    execOptions
  );
}

export async function dockerComposeBuild(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  registryCredentials: ContainerRegistryCredential[] = [],
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Building compose project ${projectName} (service: ${scopedServiceName})`
      : `Building compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("build");
  if (scopedServiceName) {
    args.push("--with-dependencies");
    args.push(scopedServiceName);
  }

  const execution = wrapDockerCommandWithRegistryAuth({
    command: dockerCommand,
    args,
    registries: registryCredentials
  });
  const execOptions =
    execution.stdin === undefined
      ? { inheritParentEnv: false }
      : { inheritParentEnv: false, stdin: execution.stdin };

  return execRunner(
    execution.command,
    execution.args,
    cwd,
    onLog,
    { ...composeExecutionEnv.env, ...COMPOSE_BUILD_ENV },
    execOptions
  );
}

export async function dockerComposeUp(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  registryCredentials: ContainerRegistryCredential[] = [],
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Starting compose project ${projectName} (service: ${scopedServiceName})`
      : `Starting compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("up", "-d", "--remove-orphans");
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  const execution = wrapDockerCommandWithRegistryAuth({
    command: dockerCommand,
    args,
    registries: registryCredentials
  });
  const execOptions =
    execution.stdin === undefined
      ? { inheritParentEnv: false }
      : { inheritParentEnv: false, stdin: execution.stdin };

  return execRunner(
    execution.command,
    execution.args,
    cwd,
    onLog,
    composeExecutionEnv.env,
    execOptions
  );
}

export async function dockerComposePs(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  const args = ["compose", "-f", composeFile, "-p", projectName];

  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("ps", "--format", "json");

  const scopedServiceName = composeServiceName?.trim();
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await execRunner(
    dockerCommand,
    args,
    cwd,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    composeExecutionEnv.env,
    { inheritParentEnv: false }
  );

  return {
    exitCode: result.exitCode,
    statuses: result.exitCode === 0 ? parseComposePsOutput(stdoutLines.join("\n")) : []
  };
}

export async function dockerComposeDown(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: `Stopping compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  return execRunner(
    dockerCommand,
    envFile
      ? ["compose", "-f", composeFile, "-p", projectName, "--env-file", envFile, "down"]
      : ["compose", "-f", composeFile, "-p", projectName, "down"],
    cwd,
    onLog,
    composeExecutionEnv.env,
    { inheritParentEnv: false }
  );
}
