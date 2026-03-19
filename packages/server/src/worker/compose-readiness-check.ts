import { Socket } from "node:net";
import {
  buildComposeReadinessProbeUrl,
  type ComposeHttpInternalNetworkReadinessProbe,
  type ComposeHttpPublishedPortReadinessProbe,
  type ComposeReadinessProbeSnapshot,
  type ComposeTcpInternalNetworkReadinessProbe,
  type ComposeTcpPublishedPortReadinessProbe
} from "../compose-readiness";
import { type ComposeContainerStatus } from "./compose-health";
import { execStreaming, type OnLog } from "./docker-executor";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

export type ComposeReadinessAttempt =
  | {
      kind: "success";
      summary: string;
    }
  | {
      kind: "pending";
      summary: string;
    }
  | {
      kind: "failed";
      summary: string;
    };

interface InternalNetworkTarget {
  containerName: string;
  address: string;
}

type LocalExecRunner = typeof execStreaming;
type HttpComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeHttpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeHttpInternalNetworkReadinessProbe);
type TcpComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeTcpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeTcpInternalNetworkReadinessProbe);
type PublishedPortComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeHttpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeTcpPublishedPortReadinessProbe);

function readinessDisplayTarget(probe: ComposeReadinessProbeSnapshot): string {
  return buildComposeReadinessProbeUrl(probe, probe.serviceName);
}

function summarizeSuccess(probe: ComposeReadinessProbeSnapshot, detail: string): string {
  return `${probe.serviceName} readiness probe passed at ${readinessDisplayTarget(probe)} (${detail})`;
}

function summarizePending(probe: ComposeReadinessProbeSnapshot, detail: string): string {
  return `${probe.serviceName} readiness probe is still waiting on ${readinessDisplayTarget(probe)} (${detail})`;
}

function buildRequestTimeoutMs(probe: ComposeReadinessProbeSnapshot): number {
  return Math.min(10_000, Math.max(1_000, probe.intervalSeconds * 1_000));
}

function buildTcpTimeoutMs(probe: ComposeReadinessProbeSnapshot): number {
  return buildRequestTimeoutMs(probe);
}

function isTcpProbe(
  probe: ComposeReadinessProbeSnapshot
): probe is TcpComposeReadinessProbeSnapshot {
  return probe.type === "tcp";
}

function isPublishedPortProbe(
  probe: ComposeReadinessProbeSnapshot
): probe is PublishedPortComposeReadinessProbeSnapshot {
  return probe.target === "published-port";
}

function isSuccessfulStatus(probe: HttpComposeReadinessProbeSnapshot, status: number): boolean {
  return probe.successStatusCodes.includes(status);
}

function collectTargetContainerNames(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[]
): string[] {
  return Array.from(
    new Set(
      statuses
        .filter(
          (status) =>
            status.service === probe.serviceName &&
            status.name.trim().length > 0 &&
            status.state.trim().toLowerCase() === "running"
        )
        .map((status) => status.name.trim())
    )
  );
}

async function readLocalContainerAddresses(
  containerName: string,
  execRunner: LocalExecRunner
): Promise<string[]> {
  const stdoutLines: string[] = [];
  const result = await execRunner(
    "docker",
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{println .IPAddress}}{{end}}{{end}}",
      containerName
    ],
    process.cwd(),
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message.trim());
      }
    }
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return stdoutLines
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function readRemoteContainerAddresses(
  target: SSHTarget,
  containerName: string,
  onLog: OnLog,
  exec: typeof execRemote
): Promise<string[]> {
  const stdoutLines: string[] = [];
  const result = await exec(
    target,
    `docker inspect --format ${shellQuote("{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{println .IPAddress}}{{end}}{{end}}")} ${shellQuote(containerName)}`,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message.trim());
        return;
      }

      onLog(line);
    }
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return stdoutLines
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function resolveLocalInternalNetworkTargets(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  execRunner: LocalExecRunner
): Promise<InternalNetworkTarget[]> {
  const targets: InternalNetworkTarget[] = [];

  for (const containerName of collectTargetContainerNames(probe, statuses)) {
    const addresses = await readLocalContainerAddresses(containerName, execRunner);
    for (const address of addresses) {
      targets.push({
        containerName,
        address
      });
    }
  }

  return targets;
}

async function resolveRemoteInternalNetworkTargets(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  onLog: OnLog,
  exec: typeof execRemote
): Promise<InternalNetworkTarget[]> {
  const targets: InternalNetworkTarget[] = [];

  for (const containerName of collectTargetContainerNames(probe, statuses)) {
    const addresses = await readRemoteContainerAddresses(target, containerName, onLog, exec);
    for (const address of addresses) {
      targets.push({
        containerName,
        address
      });
    }
  }

  return targets;
}

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
  const timeoutMs = buildTcpTimeoutMs(probe);

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

function summarizeInternalNetworkAttempt(
  probe: ComposeReadinessProbeSnapshot,
  attempts: Array<{ target: InternalNetworkTarget; attempt: ComposeReadinessAttempt }>
): ComposeReadinessAttempt {
  const failed = attempts.find((entry) => entry.attempt.kind === "failed");
  if (failed) {
    return failed.attempt;
  }

  const pending = attempts.filter((entry) => entry.attempt.kind === "pending");
  if (pending.length > 0) {
    const details = pending
      .map(
        (entry) => `${entry.target.containerName}@${entry.target.address}: ${entry.attempt.summary}`
      )
      .join("; ");
    return {
      kind: "pending",
      summary: summarizePending(probe, details)
    };
  }

  return {
    kind: "success",
    summary: summarizeSuccess(
      probe,
      `${attempts.length}/${attempts.length} container${attempts.length === 1 ? "" : "s"} responded successfully`
    )
  };
}

export async function runLocalComposeReadinessCheck(
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  fetchImpl: typeof fetch = fetch,
  execRunner: LocalExecRunner = execStreaming
): Promise<ComposeReadinessAttempt> {
  if (isPublishedPortProbe(probe)) {
    if (isTcpProbe(probe)) {
      return runLocalTcpProbe(probe, probe.host, probe.port);
    }

    return runLocalHttpProbe(probe, buildComposeReadinessProbeUrl(probe), fetchImpl);
  }

  const internalTargets = await resolveLocalInternalNetworkTargets(probe, statuses, execRunner);
  if (internalTargets.length === 0) {
    return {
      kind: "pending",
      summary: summarizePending(probe, "no running container addresses are available yet")
    };
  }

  const attempts: Array<{ target: InternalNetworkTarget; attempt: ComposeReadinessAttempt }> = [];
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

export async function runRemoteComposeReadinessCheck(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  statuses: ComposeContainerStatus[],
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<ComposeReadinessAttempt> {
  if (isPublishedPortProbe(probe)) {
    if (isTcpProbe(probe)) {
      return runRemoteTcpProbe(target, probe, probe.host, probe.port, onLog, exec);
    }

    return runRemoteHttpProbe(target, probe, buildComposeReadinessProbeUrl(probe), onLog, exec);
  }

  const internalTargets = await resolveRemoteInternalNetworkTargets(
    target,
    probe,
    statuses,
    onLog,
    exec
  );
  if (internalTargets.length === 0) {
    return {
      kind: "pending",
      summary: summarizePending(probe, "no running container addresses are available yet")
    };
  }

  const attempts: Array<{ target: InternalNetworkTarget; attempt: ComposeReadinessAttempt }> = [];
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
