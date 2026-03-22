import type { ContainerRegistryCredential } from "../container-registries-shared";
import { type ComposeExecutionScope } from "../compose-build-plan-execution";
import {
  dockerComposeBuild,
  dockerComposeDown,
  dockerComposePull,
  dockerComposeUp,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  remoteDockerComposeBuild,
  remoteDockerComposeDown,
  remoteDockerComposePull,
  remoteDockerComposeUp,
  remoteDockerStackDeploy,
  remoteDockerStackRemove
} from "./ssh-executor";
import { dockerStackDeploy, dockerStackRemove } from "./swarm-executor";

export async function runComposeStopOperation(input: {
  swarmManagerTarget: boolean;
  target: ExecutionTarget;
  projectName: string;
  workDir: string;
  composeFile: string;
  onLog: OnLog;
  composeEnvFile?: string;
  composeEnvExportFile?: string;
}): Promise<{ exitCode: number }> {
  if (input.swarmManagerTarget) {
    return input.target.mode === "remote"
      ? remoteDockerStackRemove(input.target.ssh, input.projectName, input.workDir, input.onLog)
      : dockerStackRemove(input.projectName, input.workDir, input.onLog);
  }

  return input.target.mode === "remote"
    ? remoteDockerComposeDown(
        input.target.ssh,
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeEnvExportFile
      )
    : dockerComposeDown(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile
      );
}

export async function runComposePullOperation(input: {
  target: ExecutionTarget;
  composeFile: string;
  projectName: string;
  workDir: string;
  onLog: OnLog;
  composeEnvFile?: string;
  composeEnvExportFile?: string;
  composeServiceName?: string;
  registryCredentials?: ContainerRegistryCredential[];
}): Promise<{ exitCode: number }> {
  return input.target.mode === "remote"
    ? remoteDockerComposePull(
        input.target.ssh,
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeEnvExportFile,
        input.composeServiceName,
        input.registryCredentials
      )
    : dockerComposePull(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeServiceName,
        input.registryCredentials
      );
}

export async function runComposeBuildOperation(input: {
  target: ExecutionTarget;
  composeFile: string;
  projectName: string;
  workDir: string;
  onLog: OnLog;
  composeEnvFile?: string;
  composeEnvExportFile?: string;
  executionScope: ComposeExecutionScope;
  registryCredentials?: ContainerRegistryCredential[];
}): Promise<{ exitCode: number }> {
  return input.target.mode === "remote"
    ? remoteDockerComposeBuild(
        input.target.ssh,
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeEnvExportFile,
        input.executionScope.requestedServiceName ?? undefined,
        input.registryCredentials
      )
    : dockerComposeBuild(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.executionScope.requestedServiceName ?? undefined,
        input.registryCredentials
      );
}

export async function runComposeStartOperation(input: {
  swarmManagerTarget: boolean;
  target: ExecutionTarget;
  composeFile: string;
  projectName: string;
  workDir: string;
  onLog: OnLog;
  composeEnvFile?: string;
  composeEnvExportFile?: string;
  composeServiceName?: string;
  registryCredentials?: ContainerRegistryCredential[];
}): Promise<{ exitCode: number }> {
  if (input.swarmManagerTarget) {
    return input.target.mode === "remote"
      ? remoteDockerStackDeploy(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          input.registryCredentials
        )
      : dockerStackDeploy(
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.registryCredentials
        );
  }

  return input.target.mode === "remote"
    ? remoteDockerComposeUp(
        input.target.ssh,
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeEnvExportFile,
        input.composeServiceName,
        input.registryCredentials
      )
    : dockerComposeUp(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeServiceName,
        input.registryCredentials
      );
}
