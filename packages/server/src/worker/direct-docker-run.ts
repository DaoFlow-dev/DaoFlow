import { buildDockerOwnershipLabels, type DockerOwnershipIdentity } from "../docker-ownership";
import { dockerRun, type OnLog } from "./docker-executor";
import { ensureDirectDockerVolumeOwnership } from "./direct-volume-ownership";
import type { ExecutionTarget } from "./execution-target";
import { remoteDockerRun } from "./ssh-executor";
import type { ConfigSnapshot } from "./step-management";

export async function runOwnedDockerContainer(input: {
  tag: string;
  containerName: string;
  config: ConfigSnapshot;
  ownership: DockerOwnershipIdentity;
  onLog: OnLog;
  target: ExecutionTarget;
  signal?: AbortSignal;
}): Promise<{ exitCode: number }> {
  const { config, ownership } = input;
  await ensureDirectDockerVolumeOwnership({
    target: input.target,
    declarations: config.volumes ?? [],
    ownership,
    onLog: input.onLog,
    signal: input.signal
  });

  const options = {
    ports: config.ports ?? [],
    volumes: config.volumes ?? [],
    env: config.env ?? {},
    network: config.network,
    labels: buildDockerOwnershipLabels(ownership)
  };
  return input.target.mode === "remote"
    ? remoteDockerRun(
        input.target.ssh,
        input.tag,
        input.containerName,
        options,
        input.onLog,
        input.signal
      )
    : dockerRun(input.tag, input.containerName, options, input.onLog, input.signal);
}
