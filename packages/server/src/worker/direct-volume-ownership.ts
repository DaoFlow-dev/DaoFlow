import {
  buildDockerOwnershipLabels,
  matchesDockerOwnership,
  readDockerOwnershipIdentity,
  type DockerOwnershipIdentity
} from "../docker-ownership";
import { createDockerVolume, inspectDockerVolume, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { createRemoteDockerVolume, inspectRemoteDockerVolume } from "./ssh-executor";

function isBindMountSource(source: string): boolean {
  return source.startsWith("/") || source.startsWith(".") || source.startsWith("~");
}

function namedVolumeFromDeclaration(declaration: string): string | null {
  const [source, target] = declaration.split(":", 3);
  if (!target) {
    throw new Error(
      `Direct Docker volume declaration "${declaration}" is anonymous and cannot be safely owned.`
    );
  }
  if (!source) {
    throw new Error(
      `Direct Docker volume declaration "${declaration}" is anonymous and cannot be safely owned.`
    );
  }
  if (isBindMountSource(source)) {
    return null;
  }
  return source;
}

export function collectNamedDirectDockerVolumes(declarations: readonly string[]): string[] {
  return [
    ...new Set(
      declarations.map(namedVolumeFromDeclaration).filter((name): name is string => name !== null)
    )
  ];
}

export async function ensureDirectDockerVolumeOwnership(input: {
  target: ExecutionTarget;
  declarations: readonly string[];
  ownership: DockerOwnershipIdentity;
  onLog: OnLog;
  signal?: AbortSignal;
}): Promise<void> {
  const names = collectNamedDirectDockerVolumes(input.declarations);
  const labels = buildDockerOwnershipLabels(input.ownership);

  for (const name of names) {
    const volume =
      input.target.mode === "remote"
        ? await inspectRemoteDockerVolume(input.target.ssh, name, input.onLog, input.signal)
        : await inspectDockerVolume(name, input.onLog, input.signal);

    if (!volume.exists) {
      const created =
        input.target.mode === "remote"
          ? await createRemoteDockerVolume(
              input.target.ssh,
              name,
              labels,
              input.onLog,
              input.signal
            )
          : await createDockerVolume(name, labels, input.onLog, input.signal);
      if (created.exitCode !== 0) {
        throw new Error(`Unable to create Docker volume "${name}" for this deployment.`);
      }
      continue;
    }

    const parsed = readDockerOwnershipIdentity(volume.labels);
    if (parsed.status === "unmanaged") {
      input.onLog({
        stream: "stdout",
        message: `Using existing unlabeled Docker volume "${name}" as an external resource; DaoFlow will not adopt or delete it.`,
        timestamp: new Date()
      });
      continue;
    }
    if (parsed.status === "invalid") {
      throw new Error(`Docker volume "${name}" cannot be safely used: ${parsed.reason}`);
    }
    if (!matchesDockerOwnership(parsed.identity, input.ownership, { includeDeploymentId: false })) {
      throw new Error(`Docker volume "${name}" belongs to another DaoFlow deployment scope.`);
    }
  }
}
