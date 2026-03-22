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
}): Promise<ComposeReadinessAttempt> {
  return input.target.mode === "remote"
    ? runRemoteComposeReadinessCheck(
        input.target.ssh,
        input.readinessProbe,
        input.statuses,
        input.onLog
      )
    : runLocalComposeReadinessCheck(input.readinessProbe, input.statuses);
}

export async function runSwarmHealthReadinessCheck(input: {
  stackName: string;
  workDir: string;
  readinessProbe: ComposeReadinessProbeSnapshot;
  tasks: SwarmTaskStatus[];
  onLog: OnLog;
  target: ExecutionTarget;
}): Promise<ComposeReadinessAttempt> {
  if (input.readinessProbe.target === "internal-network") {
    const internalTargets = await resolveSwarmInternalNetworkTargets({
      stackName: input.stackName,
      workDir: input.workDir,
      probe: input.readinessProbe,
      tasks: input.tasks,
      onLog: input.onLog,
      target: input.target
    });

    return input.target.mode === "remote"
      ? runRemoteInternalNetworkReadinessCheck(
          input.target.ssh,
          input.readinessProbe,
          internalTargets,
          input.onLog
        )
      : runLocalInternalNetworkReadinessCheck(input.readinessProbe, internalTargets);
  }

  return input.target.mode === "remote"
    ? runRemoteComposeReadinessCheck(input.target.ssh, input.readinessProbe, [], input.onLog)
    : runLocalComposeReadinessCheck(input.readinessProbe, []);
}
