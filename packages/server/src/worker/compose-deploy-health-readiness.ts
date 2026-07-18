import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { ComposeContainerStatus } from "./compose-health";
import {
  runLocalInternalNetworkReadinessCheck,
  runLocalComposeReadinessCheck,
  runRemoteInternalNetworkReadinessCheck,
  runRemoteComposeReadinessCheck,
  type ComposeReadinessAttempt
} from "./compose-readiness-check";
import type { OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { resolveSwarmInternalNetworkTargets } from "./swarm-readiness-targets";
import type { SwarmTaskStatus } from "./swarm-health";

export async function runComposeHealthReadinessCheck(input: {
  readinessProbe: ComposeReadinessProbeSnapshot;
  statuses: ComposeContainerStatus[];
  onLog: OnLog;
  target: ExecutionTarget;
  signal?: AbortSignal;
}): Promise<ComposeReadinessAttempt> {
  return input.target.mode === "remote"
    ? runRemoteComposeReadinessCheck(
        input.target.ssh,
        input.readinessProbe,
        input.statuses,
        input.onLog,
        undefined,
        input.signal
      )
    : runLocalComposeReadinessCheck(
        input.readinessProbe,
        input.statuses,
        undefined,
        undefined,
        input.signal
      );
}

export async function runSwarmHealthReadinessCheck(input: {
  stackName: string;
  workDir: string;
  readinessProbe: ComposeReadinessProbeSnapshot;
  tasks: SwarmTaskStatus[];
  onLog: OnLog;
  target: ExecutionTarget;
  signal?: AbortSignal;
}): Promise<ComposeReadinessAttempt> {
  if (input.readinessProbe.target === "internal-network") {
    const internalTargets = await resolveSwarmInternalNetworkTargets({
      stackName: input.stackName,
      workDir: input.workDir,
      probe: input.readinessProbe,
      tasks: input.tasks,
      onLog: input.onLog,
      target: input.target,
      signal: input.signal
    });

    return input.target.mode === "remote"
      ? runRemoteInternalNetworkReadinessCheck(
          input.target.ssh,
          input.readinessProbe,
          internalTargets,
          input.onLog,
          undefined,
          input.signal
        )
      : runLocalInternalNetworkReadinessCheck(
          input.readinessProbe,
          internalTargets,
          undefined,
          input.signal
        );
  }

  return input.target.mode === "remote"
    ? runRemoteComposeReadinessCheck(
        input.target.ssh,
        input.readinessProbe,
        [],
        input.onLog,
        undefined,
        input.signal
      )
    : runLocalComposeReadinessCheck(input.readinessProbe, [], undefined, undefined, input.signal);
}
