import { spawn } from "node:child_process";
import type { ExecutionTarget } from "./execution-target";
import { sshCommand, withCommandPath } from "./command-env";
import { sshArgs, writeSSHKey, removeSSHKey } from "./ssh-connection";

export interface ServerMetricsSnapshot {
  cpuPercent: number;
  memoryUsedPercent: number;
  memoryUsedGB: number;
  memoryTotalGB: number;
  diskUsedPercent: number;
  diskTotalGB: number;
  networkInMB: number;
  networkOutMB: number;
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

const METRICS_SCRIPT = [
  // CPU: 1-second sample via /proc/stat
  `cpu1=$(cat /proc/stat | head -1); sleep 1; cpu2=$(cat /proc/stat | head -1);`,
  `echo "CPU:$(printf '%s\\n%s\\n' "$cpu1" "$cpu2" | awk '{`,
  `  if(NR==1){u1=$2+$4;t1=$2+$3+$4+$5+$6+$7+$8}`,
  `  else{u2=$2+$4;t2=$2+$3+$4+$5+$6+$7+$8;`,
  `  if(t2-t1>0)printf "%.1f",(u2-u1)/(t2-t1)*100; else print "0"}`,
  `}')"`,
  // Memory: from /proc/meminfo
  `awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{`,
  `u=t-a; printf "MEM:%.1f:%.2f:%.2f\\n",u/t*100,u/1048576,t/1048576`,
  `}' /proc/meminfo`,
  // Disk: root filesystem
  `df -BG / | awk 'NR==2{gsub("G","",$2);gsub("G","",$3);gsub("%","",$5);printf "DISK:%s:%s\\n",$5,$2}'`,
  // Network: sum all interfaces except lo
  `awk 'NR>2 && $1!~/lo/{rx+=$2;tx+=$10}END{printf "NET:%.2f:%.2f\\n",rx/1048576,tx/1048576}' /proc/net/dev`
].join("\n");

function runCommand(target: ExecutionTarget): Promise<{ exitCode: number; stdout: string[] }> {
  return new Promise((resolve, reject) => {
    let child;
    let cleanup = () => {};

    if (target.mode === "local") {
      child = spawn("bash", ["-c", METRICS_SCRIPT], {
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

      child = spawn(sshCommand, [...sshArgs(sshTarget), `bash -c ${shellQuote(METRICS_SCRIPT)}`], {
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

function parseFloat(val: string): number {
  const n = Number.parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

export async function collectServerMetrics(
  target: ExecutionTarget
): Promise<ServerMetricsSnapshot | null> {
  try {
    const result = await runCommand(target);
    if (result.exitCode !== 0) return null;

    const snapshot: ServerMetricsSnapshot = {
      cpuPercent: 0,
      memoryUsedPercent: 0,
      memoryUsedGB: 0,
      memoryTotalGB: 0,
      diskUsedPercent: 0,
      diskTotalGB: 0,
      networkInMB: 0,
      networkOutMB: 0
    };

    for (const line of result.stdout) {
      if (line.startsWith("CPU:")) {
        snapshot.cpuPercent = parseFloat(line.slice(4));
      } else if (line.startsWith("MEM:")) {
        const [pct, used, total] = line.slice(4).split(":");
        snapshot.memoryUsedPercent = parseFloat(pct ?? "0");
        snapshot.memoryUsedGB = parseFloat(used ?? "0");
        snapshot.memoryTotalGB = parseFloat(total ?? "0");
      } else if (line.startsWith("DISK:")) {
        const [pct, total] = line.slice(5).split(":");
        snapshot.diskUsedPercent = parseFloat(pct ?? "0");
        snapshot.diskTotalGB = parseFloat(total ?? "0");
      } else if (line.startsWith("NET:")) {
        const [inMB, outMB] = line.slice(4).split(":");
        snapshot.networkInMB = parseFloat(inMB ?? "0");
        snapshot.networkOutMB = parseFloat(outMB ?? "0");
      }
    }

    return snapshot;
  } catch {
    return null;
  }
}
