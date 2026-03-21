import { execStreaming, type OnLog } from "./docker-executor";
import { dockerCommand } from "./command-env";
import { formatComposeExecutionEnvSummary, prepareComposeCommandEnv } from "./compose-command-env";
import {
  parseSwarmServiceLsOutput,
  parseSwarmTaskPsOutput,
  type SwarmServiceStatus,
  type SwarmTaskStatus
} from "./swarm-health";

type ExecRunner = typeof execStreaming;

export async function dockerStackDeploy(
  composeFile: string,
  stackName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const executionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: `Deploying swarm stack ${stackName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(executionEnv.summary),
    timestamp: new Date()
  });

  return execRunner(
    dockerCommand,
    ["stack", "deploy", "--compose-file", composeFile, "--prune", stackName],
    cwd,
    onLog,
    executionEnv.env,
    { inheritParentEnv: false }
  );
}

export async function dockerStackRemove(
  stackName: string,
  cwd: string,
  onLog: OnLog,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const executionEnv = prepareComposeCommandEnv(cwd);
  onLog({
    stream: "stdout",
    message: `Removing swarm stack ${stackName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(executionEnv.summary),
    timestamp: new Date()
  });

  return execRunner(dockerCommand, ["stack", "rm", stackName], cwd, onLog, executionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerStackServices(
  stackName: string,
  cwd: string,
  onLog: OnLog,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; services: SwarmServiceStatus[] }> {
  const executionEnv = prepareComposeCommandEnv(cwd);
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(executionEnv.summary),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await execRunner(
    dockerCommand,
    ["stack", "services", stackName, "--format", "json"],
    cwd,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    executionEnv.env,
    { inheritParentEnv: false }
  );

  return {
    exitCode: result.exitCode,
    services: result.exitCode === 0 ? parseSwarmServiceLsOutput(stdoutLines.join("\n")) : []
  };
}

export async function dockerStackPs(
  stackName: string,
  cwd: string,
  onLog: OnLog,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; tasks: SwarmTaskStatus[] }> {
  const executionEnv = prepareComposeCommandEnv(cwd);
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(executionEnv.summary),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await execRunner(
    dockerCommand,
    ["stack", "ps", stackName, "--filter", "desired-state=running", "--format", "json"],
    cwd,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    executionEnv.env,
    { inheritParentEnv: false }
  );

  return {
    exitCode: result.exitCode,
    tasks: result.exitCode === 0 ? parseSwarmTaskPsOutput(stdoutLines.join("\n")) : []
  };
}
