import { existsSync } from "node:fs";

const DEFAULT_COMMAND_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

type CommandEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

function resolveCommandBinary(
  envVarName: "DOCKER_BIN" | "SSH_BIN" | "SCP_BIN",
  fallbackName: string,
  candidates: string[]
): string {
  const explicit = process.env[envVarName]?.trim();
  if (explicit) {
    return explicit;
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? fallbackName;
}

export const dockerCommand = resolveCommandBinary("DOCKER_BIN", "docker", [
  "/usr/bin/docker",
  "/usr/local/bin/docker"
]);
export const sshCommand = resolveCommandBinary("SSH_BIN", "ssh", ["/usr/bin/ssh", "/bin/ssh"]);
export const scpCommand = resolveCommandBinary("SCP_BIN", "scp", ["/usr/bin/scp", "/bin/scp"]);

export function withCommandPath(env: CommandEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: env.PATH?.trim() ? env.PATH : DEFAULT_COMMAND_PATH
  };
}
