import {
  buildComposeReadinessProbeUrl,
  type ComposeHttpInternalNetworkReadinessProbe,
  type ComposeHttpPublishedPortReadinessProbe,
  type ComposeReadinessProbeSnapshot,
  type ComposeTcpInternalNetworkReadinessProbe,
  type ComposeTcpPublishedPortReadinessProbe
} from "../compose-readiness";

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

export type HttpComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeHttpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeHttpInternalNetworkReadinessProbe);
export type TcpComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeTcpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeTcpInternalNetworkReadinessProbe);
export type PublishedPortComposeReadinessProbeSnapshot =
  | (ComposeReadinessProbeSnapshot & ComposeHttpPublishedPortReadinessProbe)
  | (ComposeReadinessProbeSnapshot & ComposeTcpPublishedPortReadinessProbe);

export function isTcpProbe(
  probe: ComposeReadinessProbeSnapshot
): probe is TcpComposeReadinessProbeSnapshot {
  return probe.type === "tcp";
}

export function isPublishedPortProbe(
  probe: ComposeReadinessProbeSnapshot
): probe is PublishedPortComposeReadinessProbeSnapshot {
  return probe.target === "published-port";
}

function readinessDisplayTarget(probe: ComposeReadinessProbeSnapshot): string {
  return buildComposeReadinessProbeUrl(probe, probe.serviceName);
}

export function summarizeSuccess(probe: ComposeReadinessProbeSnapshot, detail: string): string {
  return `${probe.serviceName} readiness probe passed at ${readinessDisplayTarget(probe)} (${detail})`;
}

export function summarizePending(probe: ComposeReadinessProbeSnapshot, detail: string): string {
  return `${probe.serviceName} readiness probe is still waiting on ${readinessDisplayTarget(probe)} (${detail})`;
}

export function summarizeNoInternalNetworkTargets(
  probe: ComposeReadinessProbeSnapshot
): ComposeReadinessAttempt {
  return {
    kind: "pending",
    summary: summarizePending(probe, "no running container addresses are available yet")
  };
}

export function summarizeInternalNetworkAttempt(
  probe: ComposeReadinessProbeSnapshot,
  attempts: Array<{
    target: { label: string; address: string };
    attempt: ComposeReadinessAttempt;
  }>
): ComposeReadinessAttempt {
  const failed = attempts.find((entry) => entry.attempt.kind === "failed");
  if (failed) {
    return failed.attempt;
  }

  const pending = attempts.filter((entry) => entry.attempt.kind === "pending");
  if (pending.length > 0) {
    const details = pending
      .map((entry) => `${entry.target.label}@${entry.target.address}: ${entry.attempt.summary}`)
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

export function buildRequestTimeoutMs(probe: ComposeReadinessProbeSnapshot): number {
  return Math.min(10_000, Math.max(1_000, probe.intervalSeconds * 1_000));
}

export function isSuccessfulStatus(
  probe: HttpComposeReadinessProbeSnapshot,
  status: number
): boolean {
  return probe.successStatusCodes.includes(status);
}
