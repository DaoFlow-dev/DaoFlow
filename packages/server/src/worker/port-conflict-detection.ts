import { spawn } from "node:child_process";
import type { ExecutionTarget } from "./execution-target";
import { sshCommand, withCommandPath } from "./command-env";
import { sshArgs, writeSSHKey, removeSSHKey } from "./ssh-connection";

export interface PortConflict {
  port: number;
  protocol: "tcp" | "udp";
  occupiedBy: string;
}

export interface PortConflictReport {
  conflicts: PortConflict[];
  checked: Array<{ port: number; protocol: "tcp" | "udp" }>;
}

function buildCheckScript(ports: Array<{ port: number; protocol: string }>): string {
  const checks = ports.map(({ port, protocol }) => {
    const proto = protocol === "udp" ? "udp" : "tcp";
    return `ss -lnp${proto === "udp" ? "u" : "t"} sport = :${port} 2>/dev/null | awk 'NR>1{print "CONFLICT:${port}:${proto}:" $NF}'`;
  });
  return checks.join("\n");
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function collectOutput(
  target: ExecutionTarget,
  script: string
): Promise<{ exitCode: number; stdout: string[] }> {
  return new Promise((resolve, reject) => {
    let child;
    let cleanup = () => {};

    if (target.mode === "local") {
      child = spawn("bash", ["-c", script], {
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(process.env)
      });
    } else {
      const sshTarget =
        !target.ssh.privateKeyPath && target.ssh.privateKey
          ? {
              ...target.ssh,
              privateKeyPath: writeSSHKey(target.ssh.serverName, target.ssh.privateKey)
            }
          : target.ssh;

      child = spawn(sshCommand, [...sshArgs(sshTarget), `bash -c ${shellQuote(script)}`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(process.env)
      });

      cleanup = () => {
        if (sshTarget.privateKeyPath && sshTarget.privateKeyPath !== target.ssh.privateKeyPath) {
          removeSSHKey(sshTarget.privateKeyPath);
        }
      };
    }

    const stdout: string[] = [];
    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) stdout.push(line);
      }
    });
    child.stdout?.on("end", () => {
      if (buf.length > 0) stdout.push(buf);
    });

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ exitCode: code ?? 1, stdout });
    });
  });
}

export async function detectPortConflicts(
  target: ExecutionTarget,
  ports: Array<{ port: number; protocol: "tcp" | "udp" }>
): Promise<PortConflictReport> {
  if (ports.length === 0) {
    return { conflicts: [], checked: [] };
  }

  try {
    const script = buildCheckScript(ports);
    const result = await collectOutput(target, script);
    const conflicts: PortConflict[] = [];

    for (const line of result.stdout) {
      if (!line.startsWith("CONFLICT:")) continue;
      const parts = line.split(":");
      const port = parseInt(parts[1] ?? "", 10);
      const protocol = parts[2] === "udp" ? ("udp" as const) : ("tcp" as const);
      const occupiedBy = parts.slice(3).join(":").trim() || "unknown";
      if (Number.isFinite(port)) {
        conflicts.push({ port, protocol, occupiedBy });
      }
    }

    return { conflicts, checked: ports };
  } catch {
    return { conflicts: [], checked: ports };
  }
}
