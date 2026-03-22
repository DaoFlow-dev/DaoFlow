import type { ContainerRegistryCredential } from "../container-registries-shared";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function buildRegistryLoginScript(registries: ContainerRegistryCredential[]): string {
  return registries
    .map(
      (registry) =>
        `printf %s ${shellQuote(registry.password)} | docker login ${shellQuote(
          registry.registryHost
        )} -u ${shellQuote(registry.username)} --password-stdin >/dev/null`
    )
    .join("\n");
}

export function buildRegistryAwareShellCommand(
  commandLine: string,
  registries: ContainerRegistryCredential[]
): string {
  if (registries.length === 0) {
    return commandLine;
  }

  return [
    "set -e",
    'docker_config_dir="$(mktemp -d)"',
    'cleanup() { rm -rf "$docker_config_dir"; }',
    "trap cleanup EXIT",
    'export DOCKER_CONFIG="$docker_config_dir"',
    buildRegistryLoginScript(registries),
    commandLine
  ].join("\n");
}

export function wrapDockerCommandWithRegistryAuth(input: {
  command: string;
  args: string[];
  registries: ContainerRegistryCredential[];
}): { command: string; args: string[]; stdin?: string } {
  if (input.registries.length === 0) {
    return {
      command: input.command,
      args: input.args
    };
  }

  return {
    command: "sh",
    args: [],
    stdin: buildRegistryAwareShellCommand(
      buildCommandLine(input.command, input.args),
      input.registries
    )
  };
}
