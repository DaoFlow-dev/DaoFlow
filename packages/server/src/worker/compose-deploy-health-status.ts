import type { ComposeContainerStatus } from "./compose-health";
import { dockerComposePs, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  remoteDockerComposePs,
  remoteDockerStackPs,
  remoteDockerStackServices
} from "./ssh-executor";
import { dockerStackPs, dockerStackServices } from "./swarm-executor";
import type { SwarmServiceStatus, SwarmTaskStatus } from "./swarm-health";

export interface ComposeHealthStatusResult {
  exitCode: number;
  statuses: ComposeContainerStatus[];
}

export interface SwarmHealthStatusResult {
  serviceResult: {
    exitCode: number;
    services: SwarmServiceStatus[];
  };
  taskResult: {
    exitCode: number;
    tasks: SwarmTaskStatus[];
  };
}

export async function readComposeHealthStatuses(
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  target: ExecutionTarget,
  envFile?: string,
  envExportFile?: string,
  composeServiceName?: string
): Promise<ComposeHealthStatusResult> {
  return target.mode === "remote"
    ? remoteDockerComposePs(
        target.ssh,
        composeFile,
        projectName,
        workDir,
        onLog,
        envFile,
        envExportFile,
        composeServiceName
      )
    : dockerComposePs(composeFile, projectName, workDir, onLog, envFile, composeServiceName);
}

export async function readSwarmHealthStatuses(
  stackName: string,
  workDir: string,
  onLog: OnLog,
  target: ExecutionTarget
): Promise<SwarmHealthStatusResult> {
  const [serviceResult, taskResult] = await Promise.all([
    target.mode === "remote"
      ? remoteDockerStackServices(target.ssh, stackName, workDir, onLog)
      : dockerStackServices(stackName, workDir, onLog),
    target.mode === "remote"
      ? remoteDockerStackPs(target.ssh, stackName, workDir, onLog)
      : dockerStackPs(stackName, workDir, onLog)
  ]);

  return {
    serviceResult,
    taskResult
  };
}
