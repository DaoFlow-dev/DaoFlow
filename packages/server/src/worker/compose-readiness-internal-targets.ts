import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import { dockerCommand } from "./command-env";
import type { ComposeContainerStatus } from "./compose-health";
import { execStreaming, type OnLog } from "./docker-executor";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

export interface ComposeInternalNetworkTarget {
  label: string;
  address: string;
}

type LocalExecRunner = typeof execStreaming;

function collectTargetContainerNames(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[]
): string[] {
  return Array.from(
    new Set(
      statuses
        .filter(
          (status) =>
            status.service === probe.serviceName &&
            status.name.trim().length > 0 &&
            status.state.trim().toLowerCase() === "running"
        )
        .map((status) => status.name.trim())
    )
  );
}

async function readLocalContainerAddresses(
  containerName: string,
  execRunner: LocalExecRunner,
  signal?: AbortSignal
): Promise<string[]> {
  const stdoutLines: string[] = [];
  const result = await execRunner(
    dockerCommand,
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{println .IPAddress}}{{end}}{{end}}",
      containerName
    ],
    process.cwd(),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message.trim());
      }
    },
    undefined,
    signal ? { signal } : undefined
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return stdoutLines
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readRemoteContainerAddresses(
  target: SSHTarget,
  containerName: string,
  onLog: OnLog,
  exec: typeof execRemote,
  signal?: AbortSignal
): Promise<string[]> {
  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    `docker inspect --format ${shellQuote("{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{println .IPAddress}}{{end}}{{end}}")} ${shellQuote(containerName)}`,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message.trim());
        return;
      }

      onLog(line);
    },
    { signal }
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return stdoutLines
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function resolveLocalInternalNetworkTargets(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  execRunner: LocalExecRunner = execStreaming,
  signal?: AbortSignal
): Promise<ComposeInternalNetworkTarget[]> {
  const targets: ComposeInternalNetworkTarget[] = [];

  for (const containerName of collectTargetContainerNames(probe, statuses)) {
    const addresses = await readLocalContainerAddresses(containerName, execRunner, signal);
    for (const address of addresses) {
      targets.push({
        label: containerName,
        address
      });
    }
  }

  return targets;
}

export async function resolveRemoteInternalNetworkTargets(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  onLog: OnLog,
  exec: typeof execRemote = execRemote,
  signal?: AbortSignal
): Promise<ComposeInternalNetworkTarget[]> {
  const targets: ComposeInternalNetworkTarget[] = [];

  for (const containerName of collectTargetContainerNames(probe, statuses)) {
    const addresses = await readRemoteContainerAddresses(
      target,
      containerName,
      onLog,
      exec,
      signal
    );
    for (const address of addresses) {
      targets.push({
        label: containerName,
        address
      });
    }
  }

  return targets;
}
