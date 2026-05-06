const HOST_DOCKER_CAPABILITIES = [
  "exec",
  "exec.stream",
  "files.read",
  "files.write",
  "archive.upload",
  "archive.download"
];

const SANDBANK_BOXLITE_CAPABILITIES = [
  ...HOST_DOCKER_CAPABILITIES,
  "snapshot",
  "port.expose",
  "terminal"
];

function readConfiguredCapabilities(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.capabilities)
    ? metadata.capabilities.filter((item): item is string => typeof item === "string")
    : [];
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
