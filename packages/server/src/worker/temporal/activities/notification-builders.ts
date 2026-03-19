/**
 * Convenience helpers that build NotificationPayload objects
 * for specific event categories (backups, deployments, etc.).
 *
 * Extracted from notification-activities.ts for AGENTS.md hygiene.
 */

import type { NotificationPayload } from "./notification-activities";

/**
 * Build a notification payload for backup events.
 * Pure synchronous builder — no I/O.
 */
export function buildBackupNotification(opts: {
  eventType: NotificationPayload["eventType"];
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
