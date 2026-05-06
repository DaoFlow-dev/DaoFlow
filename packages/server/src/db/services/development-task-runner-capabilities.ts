export const SANDBOX_CAPABILITIES = [
  "exec",
  "exec.stream",
  "files.read",
  "files.write",
  "archive.upload",
  "archive.download",
  "snapshot",
  "port.expose",
  "terminal",
  "sleep"
] as const;

export type SandboxCapability = (typeof SANDBOX_CAPABILITIES)[number];

const HOST_DOCKER_CAPABILITIES = [
  "exec",
  "exec.stream",
  "files.read",
  "files.write",
  "archive.upload",
  "archive.download"
] satisfies SandboxCapability[];

const SANDBANK_BOXLITE_CAPABILITIES = [
  ...HOST_DOCKER_CAPABILITIES,
  "snapshot",
  "port.expose",
  "terminal",
  "sleep"
] satisfies SandboxCapability[];

function isSandboxCapability(value: string): value is SandboxCapability {
  return SANDBOX_CAPABILITIES.includes(value as SandboxCapability);
}

function readConfiguredCapabilities(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.capabilities)
    ? metadata.capabilities.filter(
        (item): item is SandboxCapability => typeof item === "string" && isSandboxCapability(item)
      )
    : [];
}

export function readSandboxCapabilities(metadata: unknown) {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return readConfiguredCapabilities(record);
}

export function hasSandboxCapability(metadata: unknown, capability: SandboxCapability) {
  return readSandboxCapabilities(metadata).includes(capability);
}

export function resolveSandboxRunnerCapabilities(input: {
  provider: string;
  metadata: Record<string, unknown>;
}) {
  const configured = readConfiguredCapabilities(input.metadata);
  if (configured.length > 0) {
    return configured;
  }

  if (input.provider === "sandbank_boxlite") {
    return SANDBANK_BOXLITE_CAPABILITIES;
  }
  if (input.provider === "host_docker") {
    return HOST_DOCKER_CAPABILITIES;
  }
  return [];
}
