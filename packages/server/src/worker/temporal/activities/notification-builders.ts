/**
 * Convenience helpers that build NotificationPayload objects
 * for specific event categories (backups, deployments, etc.).
 *
 * Extracted from notification-activities.ts for AGENTS.md hygiene.
 */

import type { NotificationPayload } from "./notification-sender-types";

/**
 * Build a notification payload for backup events.
 * Pure synchronous builder — no I/O.
 */
export function buildBackupNotification(opts: {
  eventType: NotificationPayload["eventType"];
  teamId: string;
  policyName: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  status: "started" | "succeeded" | "failed";
  error?: string;
  durationMs?: number;
  sizeBytes?: number;
  artifactPath?: string;
}): Promise<NotificationPayload> {
  const severityMap = {
    started: "info" as const,
    succeeded: "success" as const,
    failed: "error" as const
  };

  const fields: NotificationPayload["fields"] = [];

  if (opts.serviceName) {
    fields.push({ name: "Service", value: opts.serviceName, inline: true });
  }
  if (opts.durationMs) {
    const secs = (opts.durationMs / 1000).toFixed(1);
    fields.push({ name: "Duration", value: `${secs}s`, inline: true });
  }
  if (opts.sizeBytes) {
    const mb = (opts.sizeBytes / (1024 * 1024)).toFixed(2);
    fields.push({ name: "Size", value: `${mb} MB`, inline: true });
  }
  if (opts.artifactPath) {
    fields.push({ name: "Artifact", value: `\`${opts.artifactPath}\``, inline: false });
  }
  if (opts.error) {
    fields.push({ name: "Error", value: opts.error.slice(0, 200), inline: false });
  }

  return Promise.resolve({
    eventType: opts.eventType,
    teamId: opts.teamId,
    title: `Backup ${opts.status}: ${opts.policyName}`,
    message:
      opts.status === "failed"
        ? `Backup for *${opts.policyName}* failed. Check the error details below.`
        : opts.status === "succeeded"
          ? `Backup for *${opts.policyName}* completed successfully.`
          : `Backup for *${opts.policyName}* has started.`,
    severity: severityMap[opts.status],
    fields,
    projectName: opts.projectName,
    environmentName: opts.environmentName,
    serviceName: opts.serviceName,
    timestamp: new Date().toISOString()
  });
}

export function buildDeployNotification(opts: {
  eventType: NotificationPayload["eventType"];
  teamId: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  status: "started" | "succeeded" | "failed" | "rollback";
  deploymentId: string;
  targetServerName?: string;
  commitSha?: string | null;
  imageTag?: string | null;
  error?: string;
}): Promise<NotificationPayload> {
  const severityMap = {
    started: "info" as const,
    succeeded: "success" as const,
    failed: "error" as const,
    rollback: "warning" as const
  };

  const fields: NotificationPayload["fields"] = [
    { name: "Deployment", value: opts.deploymentId, inline: true },
    { name: "Service", value: opts.serviceName, inline: true },
    { name: "Environment", value: opts.environmentName, inline: true }
  ];

  if (opts.targetServerName) {
    fields.push({ name: "Server", value: opts.targetServerName, inline: true });
  }
  if (opts.commitSha) {
    fields.push({ name: "Commit", value: opts.commitSha, inline: true });
  }
  if (opts.imageTag) {
    fields.push({ name: "Image", value: opts.imageTag, inline: false });
  }
  if (opts.error) {
    fields.push({ name: "Error", value: opts.error.slice(0, 200), inline: false });
  }

  const message =
    opts.status === "failed"
      ? `Deployment for *${opts.serviceName}* failed in *${opts.environmentName}*.`
      : opts.status === "succeeded"
        ? `Deployment for *${opts.serviceName}* reached a healthy state in *${opts.environmentName}*.`
        : opts.status === "rollback"
          ? `Rollback requested for *${opts.serviceName}* in *${opts.environmentName}*.`
          : `Deployment for *${opts.serviceName}* started in *${opts.environmentName}*.`;

  return Promise.resolve({
    eventType: opts.eventType,
    teamId: opts.teamId,
    title: `Deploy ${opts.status}: ${opts.serviceName}`,
    message,
    severity: severityMap[opts.status],
    fields,
    projectName: opts.projectName,
    environmentName: opts.environmentName,
    serviceName: opts.serviceName,
    timestamp: new Date().toISOString()
  });
}

export function buildApprovalNotification(opts: {
  eventType: NotificationPayload["eventType"];
  teamId: string;
  status: "requested" | "approved" | "rejected";
  requestId: string;
  actionType: string;
  resourceLabel: string;
  requestedByEmail?: string | null;
  decidedByEmail?: string | null;
  reason?: string | null;
}): Promise<NotificationPayload> {
  const severityMap = {
    requested: "warning" as const,
    approved: "success" as const,
    rejected: "error" as const
  };

  const fields: NotificationPayload["fields"] = [
    { name: "Approval Request", value: opts.requestId, inline: true },
    { name: "Action", value: opts.actionType, inline: true },
    { name: "Resource", value: opts.resourceLabel, inline: false }
  ];

  if (opts.requestedByEmail) {
    fields.push({ name: "Requested By", value: opts.requestedByEmail, inline: true });
  }
  if (opts.decidedByEmail) {
    fields.push({ name: "Decided By", value: opts.decidedByEmail, inline: true });
  }
  if (opts.reason) {
    fields.push({ name: "Reason", value: opts.reason.slice(0, 200), inline: false });
  }

  const verb =
    opts.status === "requested"
      ? "requested"
      : opts.status === "approved"
        ? "approved"
        : "rejected";

  return Promise.resolve({
    eventType: opts.eventType,
    teamId: opts.teamId,
    title: `Approval ${verb}: ${opts.resourceLabel}`,
    message: `Approval was ${verb} for *${opts.resourceLabel}*.`,
    severity: severityMap[opts.status],
    fields,
    timestamp: new Date().toISOString()
  });
}

export function buildServerMetricNotification(opts: {
  eventType:
    | "server.metrics.warning"
    | "server.metrics.hard"
    | "server.metrics.recovered"
    | "server.metrics.unreachable";
  serverName: string;
  teamId: string;
  metric: string | null;
  measuredValue: number | null;
  threshold: number | null;
  observedAt: string;
  nextState: "healthy" | "warning" | "hard" | "unreachable";
  error?: string | null;
}): Promise<NotificationPayload> {
  const status = opts.eventType.split(".").at(-1) ?? "changed";
  const severity =
    status === "recovered"
      ? ("success" as const)
      : status === "warning"
        ? ("warning" as const)
        : ("error" as const);
  const fields: NotificationPayload["fields"] = [
    { name: "Server", value: opts.serverName, inline: true },
    { name: "Observed", value: opts.observedAt, inline: true }
  ];

  if (opts.metric) {
    fields.push({ name: "Metric", value: opts.metric, inline: true });
  }
  if (opts.measuredValue !== null) {
    fields.push({ name: "Measured", value: `${opts.measuredValue.toFixed(1)}%`, inline: true });
  }
  if (opts.threshold !== null) {
    fields.push({ name: "Threshold", value: `${opts.threshold.toFixed(1)}%`, inline: true });
  }
  if (opts.error) {
    fields.push({ name: "Error", value: opts.error.slice(0, 200), inline: false });
  }

  return Promise.resolve({
    eventType: opts.eventType,
    teamId: opts.teamId,
    title: `Server metrics ${status}: ${opts.serverName}`,
    message:
      status === "recovered"
        ? opts.metric
          ? buildMetricRecoveryMessage(opts.serverName, opts.metric, opts.nextState)
          : buildAvailabilityRecoveryMessage(opts.serverName, opts.nextState)
        : status === "unreachable"
          ? `Server *${opts.serverName}* could not be reached for metric collection.`
          : `Server *${opts.serverName}* crossed a ${status} metric threshold.`,
    severity,
    fields,
    timestamp: opts.observedAt
  });
}

function buildAvailabilityRecoveryMessage(
  serverName: string,
  nextState: "healthy" | "warning" | "hard" | "unreachable" | undefined
) {
  if (nextState === "warning" || nextState === "hard") {
    return `Server *${serverName}* became reachable again, but metrics remain in a ${nextState} state.`;
  }
  if (nextState === "healthy") {
    return `Server *${serverName}* became reachable again and metrics are healthy.`;
  }
  return `Server *${serverName}* became reachable again.`;
}

function buildMetricRecoveryMessage(
  serverName: string,
  metric: string,
  nextState: "healthy" | "warning" | "hard" | "unreachable"
) {
  if (nextState === "warning" || nextState === "hard") {
    return `Server *${serverName}* ${metric} recovered below its threshold, but other metrics remain in a ${nextState} state.`;
  }
  return `Server *${serverName}* ${metric} recovered below its threshold.`;
}

export function buildTestNotification(teamId: string): Promise<NotificationPayload> {
  return Promise.resolve({
    eventType: "system.test",
    teamId,
    title: "Notification channel test",
    message: "DaoFlow successfully dispatched a test notification to this channel.",
    severity: "info",
    fields: [
      { name: "Purpose", value: "Verify channel delivery and payload formatting", inline: false }
    ],
    timestamp: new Date().toISOString()
  });
}
