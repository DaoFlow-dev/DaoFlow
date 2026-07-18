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
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
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
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("Readiness check cancelled.");
    }
    return {
      kind: "pending",
      summary: summarizePending(probe, error instanceof Error ? error.message : String(error))
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function runLocalTcpProbe(
  probe: ComposeReadinessProbeSnapshot,
  host: string,
  port: number,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  const timeoutMs = buildRequestTimeoutMs(probe);

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abortFromCaller);

    const finish = (attempt: ComposeReadinessAttempt) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.destroy();
      resolve(attempt);
    };
    const abortFromCaller = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(
        signal?.reason instanceof Error ? signal.reason : new Error("Readiness check cancelled.")
      );
    };

    if (signal?.aborted) {
      abortFromCaller();
      return;
    }
    signal?.addEventListener("abort", abortFromCaller, { once: true });

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
  exec: typeof execRemote,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  const stdoutLines: string[] = [];
  const timeoutSeconds = Math.max(1, Math.min(10, probe.intervalSeconds));
  const result = await exec(
    target,
    buildRemoteHttpProbeCommand(url, timeoutSeconds),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message.trim());
        return;
      }

      onLog(line);
    },
    { signal }
  );

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
  exec: typeof execRemote,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  const timeoutSeconds = Math.max(1, Math.min(10, probe.intervalSeconds));
  const result = await exec(target, buildRemoteTcpProbeCommand(host, port, timeoutSeconds), onLog, {
    signal
  });

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
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  if (isTcpProbe(probe)) {
    return runLocalTcpProbe(probe, probe.host, probe.port, signal);
  }

  return runLocalHttpProbe(probe, buildComposeReadinessProbeUrl(probe), fetchImpl, signal);
}

export async function runRemotePublishedPortReadinessCheck(
  target: SSHTarget,
  probe: PublishedPortComposeReadinessProbeSnapshot,
  onLog: OnLog,
  exec: typeof execRemote = execRemote,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  if (isTcpProbe(probe)) {
    return runRemoteTcpProbe(target, probe, probe.host, probe.port, onLog, exec, signal);
  }

  return runRemoteHttpProbe(
    target,
    probe,
    buildComposeReadinessProbeUrl(probe),
    onLog,
    exec,
    signal
  );
}

export async function runLocalInternalNetworkReadinessCheck(
  probe: ComposeReadinessProbeSnapshot,
  internalTargets: ComposeInternalNetworkTarget[],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  if (internalTargets.length === 0) {
    return summarizeNoInternalNetworkTargets(probe);
  }

  const attempts: Array<{
    target: ComposeInternalNetworkTarget;
    attempt: ComposeReadinessAttempt;
  }> = [];
  for (const target of internalTargets) {
    signal?.throwIfAborted();
    const attempt = isTcpProbe(probe)
      ? await runLocalTcpProbe(probe, target.address, probe.port, signal)
      : await runLocalHttpProbe(
          probe,
          `${probe.scheme}://${target.address}:${probe.port}${probe.path}`,
          fetchImpl,
          signal
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
  exec: typeof execRemote = execRemote,
  signal?: AbortSignal
): Promise<ComposeReadinessAttempt> {
  if (internalTargets.length === 0) {
    return summarizeNoInternalNetworkTargets(probe);
  }

  const attempts: Array<{
    target: ComposeInternalNetworkTarget;
    attempt: ComposeReadinessAttempt;
  }> = [];
  for (const internalTarget of internalTargets) {
    signal?.throwIfAborted();
    const attempt = isTcpProbe(probe)
      ? await runRemoteTcpProbe(
          target,
          probe,
          internalTarget.address,
          probe.port,
          onLog,
          exec,
          signal
        )
      : await runRemoteHttpProbe(
          target,
          probe,
          `${probe.scheme}://${internalTarget.address}:${probe.port}${probe.path}`,
          onLog,
          exec,
          signal
        );
    attempts.push({ target: internalTarget, attempt });
  }

  return summarizeInternalNetworkAttempt(probe, attempts);
}
