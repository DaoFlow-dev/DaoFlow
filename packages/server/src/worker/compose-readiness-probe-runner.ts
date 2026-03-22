import { Socket } from "node:net";
import {
  buildComposeReadinessProbeUrl,
  type ComposeReadinessProbeSnapshot
} from "../compose-readiness";
import { shellQuote, execRemote, type SSHTarget } from "./ssh-connection";
import type { OnLog } from "./docker-executor";
import type { ComposeInternalNetworkTarget } from "./compose-readiness-internal-targets";
import {
  buildRequestTimeoutMs,
  isSuccessfulStatus,
  isTcpProbe,
  summarizeInternalNetworkAttempt,
  summarizeNoInternalNetworkTargets,
  summarizePending,
  summarizeSuccess,
  type ComposeReadinessAttempt,
  type HttpComposeReadinessProbeSnapshot,
  type PublishedPortComposeReadinessProbeSnapshot,
  type TcpComposeReadinessProbeSnapshot
} from "./compose-readiness-probe-shared";

export {
  isPublishedPortProbe,
  type ComposeReadinessAttempt
} from "./compose-readiness-probe-shared";

async function runLocalHttpProbe(
  probe: HttpComposeReadinessProbeSnapshot,
  url: string,
  fetchImpl: typeof fetch
): Promise<ComposeReadinessAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), buildRequestTimeoutMs(probe));

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });

    if (isSuccessfulStatus(probe, response.status)) {
      return {
        kind: "success",
        summary: summarizeSuccess(probe, `HTTP ${response.status}`)
      };
    }

    return {
      kind: "pending",
      summary: summarizePending(probe, `HTTP ${response.status}`)
    };
  } catch (error) {
    return {
      kind: "pending",
      summary: summarizePending(probe, error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runLocalTcpProbe(
  probe: ComposeReadinessProbeSnapshot,
  host: string,
  port: number
): Promise<ComposeReadinessAttempt> {
  const timeoutMs = buildRequestTimeoutMs(probe);

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (attempt: ComposeReadinessAttempt) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(attempt);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({
        kind: "success",
        summary: summarizeSuccess(probe, "TCP connect")
      });
    });
    socket.once("timeout", () => {
      finish({
        kind: "pending",
        summary: summarizePending(probe, `TCP timeout after ${timeoutMs}ms`)
      });
    });
    socket.once("error", (error) => {
      finish({
        kind: "pending",
        summary: summarizePending(probe, error.message)
      });
    });

    socket.connect(port, host);
  });
}

function buildRemoteHttpProbeCommand(url: string, timeoutSeconds: number): string {
  return `curl -sS -o /dev/null -w '%{http_code}' --connect-timeout ${timeoutSeconds} --max-time ${timeoutSeconds} ${shellQuote(url)}`;
}

function buildRemoteTcpProbeCommand(host: string, port: number, timeoutSeconds: number): string {
  const script = [
    `timeout ${timeoutSeconds}s bash -lc ${shellQuote(`exec 3<>/dev/tcp/${host}/${port}`)}`,
    ">/dev/null 2>&1"
  ].join(" ");

  return script;
}

async function runRemoteHttpProbe(
  target: SSHTarget,
  probe: HttpComposeReadinessProbeSnapshot,
  url: string,
  onLog: OnLog,
  exec: typeof execRemote
): Promise<ComposeReadinessAttempt> {
  const stdoutLines: string[] = [];
  const timeoutSeconds = Math.max(1, Math.min(10, probe.intervalSeconds));
  const result = await exec(target, buildRemoteHttpProbeCommand(url, timeoutSeconds), (line) => {
    if (line.stream === "stdout") {
      stdoutLines.push(line.message.trim());
      return;
    }

    onLog(line);
  });

  if (result.exitCode === 127) {
    return {
      kind: "failed",
      summary:
        `Remote readiness probe requires curl on ${target.serverName}; ` +
        `install curl and retry ${probe.serviceName}.`
    };
  }

  const status = Number(stdoutLines.join("").trim());
  if (result.exitCode === 0 && Number.isInteger(status)) {
    if (isSuccessfulStatus(probe, status)) {
      return {
        kind: "success",
        summary: summarizeSuccess(probe, `HTTP ${status}`)
      };
    }

    return {
      kind: "pending",
      summary: summarizePending(probe, `HTTP ${status}`)
    };
  }

  return {
    kind: "pending",
    summary: summarizePending(probe, `curl exit ${result.exitCode}`)
  };
}

async function runRemoteTcpProbe(
  target: SSHTarget,
  probe: TcpComposeReadinessProbeSnapshot,
  host: string,
  port: number,
  onLog: OnLog,
  exec: typeof execRemote
): Promise<ComposeReadinessAttempt> {
  const timeoutSeconds = Math.max(1, Math.min(10, probe.intervalSeconds));
  const result = await exec(target, buildRemoteTcpProbeCommand(host, port, timeoutSeconds), onLog);

  if (result.exitCode === 127) {
    return {
      kind: "failed",
      summary:
        `Remote TCP readiness probe requires bash and timeout on ${target.serverName}; ` +
        `install them and retry ${probe.serviceName}.`
    };
  }

  if (result.exitCode === 0) {
    return {
      kind: "success",
      summary: summarizeSuccess(probe, "TCP connect")
    };
  }

  return {
    kind: "pending",
    summary: summarizePending(probe, `TCP probe exit ${result.exitCode}`)
  };
}

export async function runLocalPublishedPortReadinessCheck(
  probe: PublishedPortComposeReadinessProbeSnapshot,
  fetchImpl: typeof fetch = fetch
): Promise<ComposeReadinessAttempt> {
  if (isTcpProbe(probe)) {
    return runLocalTcpProbe(probe, probe.host, probe.port);
  }

  return runLocalHttpProbe(probe, buildComposeReadinessProbeUrl(probe), fetchImpl);
}

export async function runRemotePublishedPortReadinessCheck(
  target: SSHTarget,
  probe: PublishedPortComposeReadinessProbeSnapshot,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<ComposeReadinessAttempt> {
  if (isTcpProbe(probe)) {
    return runRemoteTcpProbe(target, probe, probe.host, probe.port, onLog, exec);
  }

  return runRemoteHttpProbe(target, probe, buildComposeReadinessProbeUrl(probe), onLog, exec);
}

export async function runLocalInternalNetworkReadinessCheck(
  probe: ComposeReadinessProbeSnapshot,
  internalTargets: ComposeInternalNetworkTarget[],
  fetchImpl: typeof fetch = fetch
): Promise<ComposeReadinessAttempt> {
  if (internalTargets.length === 0) {
    return summarizeNoInternalNetworkTargets(probe);
  }

  const attempts: Array<{
    target: ComposeInternalNetworkTarget;
    attempt: ComposeReadinessAttempt;
  }> = [];
  for (const target of internalTargets) {
    const attempt = isTcpProbe(probe)
      ? await runLocalTcpProbe(probe, target.address, probe.port)
      : await runLocalHttpProbe(
          probe,
          `${probe.scheme}://${target.address}:${probe.port}${probe.path}`,
          fetchImpl
        );
    attempts.push({ target, attempt });
  }

  return summarizeInternalNetworkAttempt(probe, attempts);
}

export async function runRemoteInternalNetworkReadinessCheck(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  internalTargets: ComposeInternalNetworkTarget[],
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<ComposeReadinessAttempt> {
  if (internalTargets.length === 0) {
    return summarizeNoInternalNetworkTargets(probe);
  }

  const attempts: Array<{
    target: ComposeInternalNetworkTarget;
    attempt: ComposeReadinessAttempt;
  }> = [];
  for (const internalTarget of internalTargets) {
    const attempt = isTcpProbe(probe)
      ? await runRemoteTcpProbe(target, probe, internalTarget.address, probe.port, onLog, exec)
      : await runRemoteHttpProbe(
          target,
          probe,
          `${probe.scheme}://${internalTarget.address}:${probe.port}${probe.path}`,
          onLog,
          exec
        );
    attempts.push({ target: internalTarget, attempt });
  }

  return summarizeInternalNetworkAttempt(probe, attempts);
}
