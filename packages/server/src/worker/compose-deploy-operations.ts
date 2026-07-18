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
  signal?: AbortSignal;
}): Promise<{ exitCode: number }> {
  if (input.swarmManagerTarget) {
    if (input.target.mode === "remote") {
      return input.signal
        ? remoteDockerStackRemove(
            input.target.ssh,
            input.projectName,
            input.workDir,
            input.onLog,
            undefined,
            input.signal
          )
        : remoteDockerStackRemove(input.target.ssh, input.projectName, input.workDir, input.onLog);
    }
    return input.signal
      ? dockerStackRemove(input.projectName, input.workDir, input.onLog, undefined, input.signal)
      : dockerStackRemove(input.projectName, input.workDir, input.onLog);
  }

  if (input.target.mode === "remote") {
    return input.signal
      ? remoteDockerComposeDown(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          undefined,
          input.signal
        )
      : remoteDockerComposeDown(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile
        );
  }
  return input.signal
    ? dockerComposeDown(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        undefined,
        input.signal
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
  signal?: AbortSignal;
}): Promise<{ exitCode: number }> {
  if (input.target.mode === "remote") {
    return input.signal
      ? remoteDockerComposePull(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          input.composeServiceName,
          input.registryCredentials,
          undefined,
          input.signal
        )
      : remoteDockerComposePull(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          input.composeServiceName,
          input.registryCredentials
        );
  }
  return input.signal
    ? dockerComposePull(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeServiceName,
        input.registryCredentials,
        undefined,
        input.signal
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
  signal?: AbortSignal;
}): Promise<{ exitCode: number }> {
  if (input.target.mode === "remote") {
    if (input.signal) {
      return remoteDockerComposeBuild(
        input.target.ssh,
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeEnvExportFile,
        input.executionScope.requestedServiceName ?? undefined,
        input.registryCredentials,
        undefined,
        input.signal
      );
    }
    return remoteDockerComposeBuild(
      input.target.ssh,
      input.composeFile,
      input.projectName,
      input.workDir,
      input.onLog,
      input.composeEnvFile,
      input.composeEnvExportFile,
      input.executionScope.requestedServiceName ?? undefined,
      input.registryCredentials
    );
  }

  if (input.signal) {
    return dockerComposeBuild(
      input.composeFile,
      input.projectName,
      input.workDir,
      input.onLog,
      input.composeEnvFile,
      input.executionScope.requestedServiceName ?? undefined,
      input.registryCredentials,
      undefined,
      input.signal
    );
  }
  return dockerComposeBuild(
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
  signal?: AbortSignal;
}): Promise<{ exitCode: number }> {
  if (input.swarmManagerTarget) {
    if (input.target.mode === "remote") {
      return input.signal
        ? remoteDockerStackDeploy(
            input.target.ssh,
            input.composeFile,
            input.projectName,
            input.workDir,
            input.onLog,
            input.composeEnvFile,
            input.composeEnvExportFile,
            input.registryCredentials,
            undefined,
            input.signal
          )
        : remoteDockerStackDeploy(
            input.target.ssh,
            input.composeFile,
            input.projectName,
            input.workDir,
            input.onLog,
            input.composeEnvFile,
            input.composeEnvExportFile,
            input.registryCredentials
          );
    }
    return input.signal
      ? dockerStackDeploy(
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.registryCredentials,
          undefined,
          input.signal
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

  if (input.target.mode === "remote") {
    return input.signal
      ? remoteDockerComposeUp(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          input.composeServiceName,
          input.registryCredentials,
          undefined,
          input.signal
        )
      : remoteDockerComposeUp(
          input.target.ssh,
          input.composeFile,
          input.projectName,
          input.workDir,
          input.onLog,
          input.composeEnvFile,
          input.composeEnvExportFile,
          input.composeServiceName,
          input.registryCredentials
        );
  }
  return input.signal
    ? dockerComposeUp(
        input.composeFile,
        input.projectName,
        input.workDir,
        input.onLog,
        input.composeEnvFile,
        input.composeServiceName,
        input.registryCredentials,
        undefined,
        input.signal
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
