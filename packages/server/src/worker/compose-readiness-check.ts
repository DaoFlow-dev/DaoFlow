import {
  buildComposeReadinessProbeUrl,
  type ComposeReadinessProbeSnapshot
} from "../compose-readiness";
import type { OnLog } from "./docker-executor";
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

function isSuccessfulStatus(probe: ComposeReadinessProbeSnapshot, status: number): boolean {
  return probe.successStatusCodes.includes(status);
}

function summarizePendingStatus(probe: ComposeReadinessProbeSnapshot, status: number): string {
  return `${probe.serviceName} readiness probe is still waiting on ${buildComposeReadinessProbeUrl(probe)} (HTTP ${status})`;
}

function summarizeSuccess(probe: ComposeReadinessProbeSnapshot, status: number): string {
  return `${probe.serviceName} readiness probe passed at ${buildComposeReadinessProbeUrl(probe)} (HTTP ${status})`;
}

function classifyHttpStatus(
  probe: ComposeReadinessProbeSnapshot,
  status: number
): ComposeReadinessAttempt {
  if (isSuccessfulStatus(probe, status)) {
    return {
      kind: "success",
      summary: summarizeSuccess(probe, status)
    };
  }

  return {
    kind: "pending",
    summary: summarizePendingStatus(probe, status)
  };
}

function buildRequestTimeoutMs(probe: ComposeReadinessProbeSnapshot): number {
  return Math.min(10_000, Math.max(1_000, probe.intervalSeconds * 1_000));
}

export async function runLocalComposeReadinessCheck(
  probe: ComposeReadinessProbeSnapshot,
  fetchImpl: typeof fetch = fetch
): Promise<ComposeReadinessAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), buildRequestTimeoutMs(probe));

  try {
    const response = await fetchImpl(buildComposeReadinessProbeUrl(probe), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    return classifyHttpStatus(probe, response.status);
  } catch (error) {
    return {
      kind: "pending",
      summary: `${probe.serviceName} readiness probe is still waiting on ${buildComposeReadinessProbeUrl(probe)} (${error instanceof Error ? error.message : String(error)})`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRemoteComposeReadinessCommand(probe: ComposeReadinessProbeSnapshot): string {
  const url = shellQuote(buildComposeReadinessProbeUrl(probe));
  const timeoutSeconds = Math.max(1, Math.min(10, probe.intervalSeconds));
  return `curl -sS -o /dev/null -w '%{http_code}' --connect-timeout ${timeoutSeconds} --max-time ${timeoutSeconds} ${url}`;
}

export async function runRemoteComposeReadinessCheck(
  target: SSHTarget,
  probe: ComposeReadinessProbeSnapshot,
  onLog: OnLog,
  exec: typeof execRemote = execRemote
): Promise<ComposeReadinessAttempt> {
  const stdoutLines: string[] = [];
  const result = await exec(target, buildRemoteComposeReadinessCommand(probe), (line) => {
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
    return classifyHttpStatus(probe, status);
  }

  return {
    kind: "pending",
    summary:
      `${probe.serviceName} readiness probe is still waiting on ${buildComposeReadinessProbeUrl(probe)} ` +
      `(curl exit ${result.exitCode})`
  };
}
