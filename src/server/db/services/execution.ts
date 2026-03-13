import { desc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "../../../shared/authz";

export type ExecutionJobStatus = "pending" | "dispatched" | "completed" | "failed";

export async function listExecutionQueue(status?: string, limit = 12) {
  const query = status
    ? db
        .select()
        .from(deployments)
        .where(eq(deployments.status, status === "pending" ? "queued" : status))
    : db
        .select()
        .from(deployments)
        .where(sql`${deployments.status} IN ('queued', 'prepare', 'deploy')`);

  const rows = await query.orderBy(desc(deployments.createdAt)).limit(limit);

  return {
    summary: {
      totalJobs: rows.length,
      pendingJobs: rows.filter((r) => r.status === "queued").length,
      dispatchedJobs: rows.filter((r) => r.status === "deploy").length,
      completedJobs: 0,
      failedJobs: rows.filter((r) => r.status === "failed").length
    },
    jobs: rows.map((r) => ({
      id: r.id,
      deploymentId: r.id,
      serviceName: r.serviceName,
      targetServerId: r.targetServerId,
      targetServerName: r.targetServerId,
      targetServerHost: r.targetServerId,
      environmentName: r.environmentId,
      projectName: r.projectId,
      queueName: "default",
      workerHint: null as string | null,
      status: r.status === "queued" ? "pending" : r.status === "deploy" ? "dispatched" : r.status,
      createdAt: r.createdAt.toISOString()
    }))
  };
}

async function mutateDeploymentStatus(
  jobId: string,
  newStatus: string,
  userId: string,
  email: string,
  role: AppRole,
  action: string,
  reason?: string
) {
  const rows = await db.select().from(deployments).where(eq(deployments.id, jobId)).limit(1);
  if (!rows[0]) return { status: "not-found" as const };

  const current = rows[0].status;
  if (current === "completed" || current === "failed") {
    return { status: "invalid-state" as const, currentStatus: current };
  }

  const conclusion =
    newStatus === "completed" ? "succeeded" : newStatus === "failed" ? "failed" : undefined;

  await db
    .update(deployments)
    .set({
      status: newStatus,
      conclusion,
      concludedAt: newStatus === "completed" || newStatus === "failed" ? new Date() : undefined,
      updatedAt: new Date()
    })
    .where(eq(deployments.id, jobId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `execution-job/${jobId}`,
    action,
    inputSummary: reason ?? `${action} for job ${jobId}`,
    permissionScope: "deploy:start",
    outcome: "success"
  });

  const [updated] = await db.select().from(deployments).where(eq(deployments.id, jobId));
  return { status: "ok" as const, job: updated };
}

export function dispatchExecutionJob(jobId: string, userId: string, email: string, role: AppRole) {
  return mutateDeploymentStatus(jobId, "deploy", userId, email, role, "execution.dispatched");
}

export function completeExecutionJob(jobId: string, userId: string, email: string, role: AppRole) {
  return mutateDeploymentStatus(jobId, "completed", userId, email, role, "execution.completed");
}

export function failExecutionJob(
  jobId: string,
  userId: string,
  email: string,
  role: AppRole,
  reason?: string
) {
  return mutateDeploymentStatus(jobId, "failed", userId, email, role, "execution.failed", reason);
}
