import { spawn } from "node:child_process";
import type { ExecutionTarget } from "./execution-target";
import { sshCommand, withCommandPath } from "./command-env";
import { removeSSHKey, sshArgs, writeSSHKey } from "./ssh-connection";

export interface HostTerminalHandle {
  write(chunk: string): void;
  close(): void;
}

export function startHostTerminal(input: {
  target: ExecutionTarget;
  shell: "bash" | "sh";
  onData: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}): HostTerminalHandle {
  let keyPath: string | null = null;
  const sshTarget =
    input.target.mode === "remote" &&
    !input.target.ssh.privateKeyPath &&
    input.target.ssh.privateKey
      ? {
          ...input.target.ssh,
          privateKeyPath: (keyPath = writeSSHKey(
            input.target.ssh.serverName,
            input.target.ssh.privateKey
          ))
        }
      : input.target.mode === "remote"
        ? input.target.ssh
        : null;

  const child =
    input.target.mode === "local"
      ? spawn(input.shell, ["-i"], {
          stdio: ["pipe", "pipe", "pipe"],
          env: withCommandPath(process.env)
        })
      : spawn(sshCommand, [...sshArgs(sshTarget!), `${input.shell} -i`], {
          stdio: ["pipe", "pipe", "pipe"],
          env: withCommandPath(process.env)
        });

  child.stdout?.on("data", (chunk: Buffer | string) => input.onData(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer | string) => input.onData(chunk.toString()));
  child.on("close", (code) => {
    if (keyPath) removeSSHKey(keyPath);
    input.onExit?.(code);
  });

  return {
    write(chunk: string) {
      child.stdin?.write(chunk);
    },
    close() {
      child.kill("SIGTERM");
      if (keyPath) removeSSHKey(keyPath);
    }
  };
}
