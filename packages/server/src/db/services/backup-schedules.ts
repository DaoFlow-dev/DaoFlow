/**
 * Backup schedule management and analytics (Temporal cron workflows).
 *
 * Extracted from backups.ts for AGENTS.md hygiene (≤500 LOC).
 * Re-exported from backups.ts to preserve import paths.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupPolicies, backupRuns } from "../schema/storage";
import type { AppRole } from "@daoflow/shared";
import {
  startBackupCronWorkflow,
  cancelBackupCronWorkflow,
  startOneOffBackupWorkflow,
  getBackupCronStatus
} from "../../worker";

// ── Schedule Management ──────────────────────────────────────

/**
 * Enable a cron schedule for a backup policy via Temporal.
 */
export async function enableBackupSchedule(
  policyId: string,
  schedule: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  // Cancel any existing cron workflow first
  if (policy.temporalWorkflowId) {
    await cancelBackupCronWorkflow(policyId);
  }

  const result = await startBackupCronWorkflow(policyId, schedule);

  await db
    .update(backupPolicies)
    .set({
      schedule,
      temporalWorkflowId: result.workflowId,
      updatedAt: new Date()
    })
    .where(eq(backupPolicies.id, policyId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.schedule.enable",
    inputSummary: `Enabled backup schedule "${schedule}" for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `Temporal workflow ${result.workflowId} started with cron: ${schedule}`
    }
  });

  return { policyId, schedule, workflowId: result.workflowId };
}

/**
 * Disable a cron schedule for a backup policy.
 */
export async function disableBackupSchedule(
  policyId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  await cancelBackupCronWorkflow(policyId);

  await db
    .update(backupPolicies)
    .set({
      schedule: null,
      temporalWorkflowId: null,
      updatedAt: new Date()
    })
    .where(eq(backupPolicies.id, policyId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.schedule.disable",
    inputSummary: `Disabled backup schedule for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `Temporal workflow cancelled for policy ${policy.name}`
    }
  });

  return { policyId, schedule: null };
}

/**
 * Trigger a one-off backup run immediately via Temporal.
 */
export async function triggerBackupNow(
  policyId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  const result = await startOneOffBackupWorkflow(policyId, userId);

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.trigger",
    inputSummary: `Triggered one-off backup for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `One-off backup workflow ${result.workflowId} started`
    }
  });

  return { policyId, workflowId: result.workflowId };
}

/**
 * Get backup schedule status for a policy from Temporal.
 */
export async function getScheduleStatus(policyId: string) {
  return getBackupCronStatus(policyId);
}

/**
 * Backup metrics — success rate, avg duration, size trends.
 */
export async function listBackupMetrics() {
  const allRuns = await db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(500);

  const now = Date.now();
  const d7 = now - 7 * 24 * 60 * 60 * 1000;
  const d30 = now - 30 * 24 * 60 * 60 * 1000;

  const runs7d = allRuns.filter((r) => r.createdAt.getTime() >= d7);
  const runs30d = allRuns.filter((r) => r.createdAt.getTime() >= d30);

  const successRate = (runs: typeof allRuns) => {
    if (runs.length === 0) return 0;
    return Math.round((runs.filter((r) => r.status === "succeeded").length / runs.length) * 100);
  };

  const avgDuration = (runs: typeof allRuns) => {
    const completed = runs.filter((r) => r.startedAt && r.completedAt);
    if (completed.length === 0) return 0;
    const total = completed.reduce((sum, r) => {
      const start = r.startedAt ? new Date(r.startedAt).getTime() : 0;
      const end = r.completedAt ? new Date(r.completedAt).getTime() : 0;
      return sum + (end - start);
    }, 0);
    return Math.round(total / completed.length / 1000);
  };

  const totalSize = (runs: typeof allRuns) => {
    return runs.reduce((sum, r) => sum + Number(r.sizeBytes ?? 0), 0);
  };

  return {
    overall: {
      totalRuns: allRuns.length,
      succeeded: allRuns.filter((r) => r.status === "succeeded").length,
      failed: allRuns.filter((r) => r.status === "failed").length,
      running: allRuns.filter((r) => r.status === "running").length
    },
    last7d: {
      runs: runs7d.length,
      successRate: successRate(runs7d),
      avgDurationSec: avgDuration(runs7d),
      totalSizeBytes: totalSize(runs7d)
    },
    last30d: {
      runs: runs30d.length,
      successRate: successRate(runs30d),
      avgDurationSec: avgDuration(runs30d),
      totalSizeBytes: totalSize(runs30d)
    }
  };
}

/**
 * Agent-ready backup diagnosis — structured failure analysis.
 */
export async function backupDiagnosis(runId: string) {
  const [run] = await db.select().from(backupRuns).where(eq(backupRuns.id, runId)).limit(1);

  if (!run) return null;

  const errorMsg = run.error ?? "";

  let category = "unknown";
  let suggestedFix = "Check the full backup logs for details.";

  if (errorMsg.includes("timeout") || errorMsg.includes("deadline")) {
    category = "timeout";
    suggestedFix = "Increase backup timeout or reduce data size. Consider incremental backups.";
  } else if (errorMsg.includes("permission") || errorMsg.includes("access denied")) {
    category = "permissions";
    suggestedFix = "Verify rclone credentials and destination access permissions.";
  } else if (
    errorMsg.includes("disk") ||
    errorMsg.includes("space") ||
    errorMsg.includes("quota")
  ) {
    category = "storage";
    suggestedFix = "Free up disk space or increase storage quota on the destination.";
  } else if (errorMsg.includes("network") || errorMsg.includes("connection")) {
    category = "network";
    suggestedFix = "Check network connectivity to the backup destination. Retry the backup.";
  } else if (
    errorMsg.includes("encrypt") ||
    errorMsg.includes("decrypt") ||
    errorMsg.includes("password")
  ) {
    category = "encryption";
    suggestedFix = "Verify the encryption password is correct. Check for password rotation issues.";
  } else if (run.status === "succeeded") {
    category = "healthy";
    suggestedFix = "No issues detected. Backup completed successfully.";
  }

  return {
    runId: run.id,
    status: run.status,
    category,
    error: errorMsg || null,
    suggestedFix,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    policyId: run.policyId
  };
}
