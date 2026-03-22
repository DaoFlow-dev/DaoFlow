import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import type { ComposeInternalNetworkTarget } from "./compose-readiness-internal-targets";
import { dockerInspectSwarmTaskNetworkAddresses } from "./swarm-executor";
import type { SwarmTaskStatus } from "./swarm-health";
import { remoteDockerInspectSwarmTaskNetworkAddresses } from "./ssh-executor";

type LocalTaskAddressInspector = typeof dockerInspectSwarmTaskNetworkAddresses;
type RemoteTaskAddressInspector = typeof remoteDockerInspectSwarmTaskNetworkAddresses;

function parseTaskPhase(task: SwarmTaskStatus): string {
  return task.currentState.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function matchesProbeServiceTask(
  stackName: string,
  probe: ComposeReadinessProbeSnapshot,
  task: SwarmTaskStatus
): boolean {
  const servicePrefix = `${stackName}_${probe.serviceName}.`;
  return (
    task.id.trim().length > 0 &&
    task.name.trim().startsWith(servicePrefix) &&
    parseTaskPhase(task) === "running"
  );
}

export async function resolveSwarmInternalNetworkTargets(
  input: {
    stackName: string;
    workDir: string;
    probe: ComposeReadinessProbeSnapshot;
    tasks: SwarmTaskStatus[];
    onLog: OnLog;
    target: ExecutionTarget;
  },
  dependencies: {
    inspectLocalTaskAddresses?: LocalTaskAddressInspector;
    inspectRemoteTaskAddresses?: RemoteTaskAddressInspector;
  } = {}
): Promise<ComposeInternalNetworkTarget[]> {
  const inspectLocalTaskAddresses =
    dependencies.inspectLocalTaskAddresses ?? dockerInspectSwarmTaskNetworkAddresses;
  const inspectRemoteTaskAddresses =
    dependencies.inspectRemoteTaskAddresses ?? remoteDockerInspectSwarmTaskNetworkAddresses;
  const targets: ComposeInternalNetworkTarget[] = [];
  const seen = new Set<string>();

  for (const task of input.tasks) {
    if (!matchesProbeServiceTask(input.stackName, input.probe, task)) {
      continue;
    }

    const result =
      input.target.mode === "remote"
        ? await inspectRemoteTaskAddresses(input.target.ssh, task.id, input.workDir, input.onLog)
        : await inspectLocalTaskAddresses(task.id, input.workDir, input.onLog);

    if (result.exitCode !== 0) {
      continue;
    }

    for (const address of result.addresses) {
      const dedupeKey = `${task.name}\u0000${address}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      targets.push({
        label: task.name,
        address
      });
    }
  }

  return targets;
}
