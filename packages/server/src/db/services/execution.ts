import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import type { AppRole } from "@daoflow/shared";

export type ExecutionJobStatus = "pending" | "dispatched" | "completed" | "failed";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function mapExecutionStatus(status: string): ExecutionJobStatus {
  if (status === "deploy") return "dispatched";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

async function resolveDisplayContext(deployment: typeof deployments.$inferSelect) {
  const [project, environment, server] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, deployment.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, deployment.environmentId)).limit(1),
    db.select().from(servers).where(eq(servers.id, deployment.targetServerId)).limit(1)
  ]);

  const snapshot = asRecord(deployment.configSnapshot);
  return {
    projectName: project[0]?.name ?? readString(snapshot, "projectName", deployment.projectId),
    environmentName:
      environment[0]?.name ?? readString(snapshot, "environmentName", deployment.environmentId),
    targetServerName:
      server[0]?.name ?? readString(snapshot, "targetServerName", deployment.targetServerId),
    targetServerHost:
      server[0]?.host ?? readString(snapshot, "targetServerHost", deployment.targetServerId),
    queueName: readString(snapshot, "queueName", "docker-ssh"),
    workerHint: readString(
      snapshot,
      "workerHint",
      `ssh://${deployment.targetServerId}/docker-engine`
    )
  };
}

export async function listExecutionQueue(status?: string, limit = 12) {
  const rows = await db
    .select()
    .from(deployments)
    .orderBy(desc(deployments.createdAt))
    .limit(limit);
  const jobs = await Promise.all(
    rows.map(async (deployment) => {
      const context = await resolveDisplayContext(deployment);
      return {
        id: deployment.id,
        deploymentId: deployment.id,
        serviceName: deployment.serviceName,
        targetServerId: deployment.targetServerId,
        targetServerName: context.targetServerName,
        targetServerHost: context.targetServerHost,
        environmentName: context.environmentName,
        projectName: context.projectName,
        queueName: context.queueName,
        workerHint: context.workerHint,
        status: mapExecutionStatus(deployment.status),
        createdAt: deployment.createdAt.toISOString()
      };
    })
  );

  const filtered = status ? jobs.filter((job) => job.status === status) : jobs;

  return {
    summary: {
      totalJobs: filtered.length,
      pendingJobs: filtered.filter((job) => job.status === "pending").length,
      dispatchedJobs: filtered.filter((job) => job.status === "dispatched").length,
      completedJobs: filtered.filter((job) => job.status === "completed").length,
      failedJobs: filtered.filter((job) => job.status === "failed").length
    },
    jobs: filtered
  };
}

async function mutateDeploymentStatus(
  jobId: string,
  newStatus: "deploy" | "completed" | "failed",
  userId: string,
  email: string,
  role: AppRole,
  action: "execution.dispatch" | "execution.complete" | "execution.fail",
  reason?: string
) {
  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, jobId))
    .limit(1);
  if (!deployment) return { status: "not-found" as const };

  if (deployment.status === "completed" || deployment.status === "failed") {
    return { status: "invalid-state" as const, currentStatus: deployment.status };
  }

  const context = await resolveDisplayContext(deployment);
  const now = new Date();
  const conclusion =
    newStatus === "completed" ? "succeeded" : newStatus === "failed" ? "failed" : null;

  await db
    .update(deployments)
    .set({
      status: newStatus,
      conclusion: conclusion ?? deployment.conclusion,
      concludedAt:
        newStatus === "completed" || newStatus === "failed" ? now : deployment.concludedAt,
      updatedAt: now
    })
    .where(eq(deployments.id, jobId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `execution-job/${jobId}`,
    action,
    inputSummary: reason ?? `${action} for ${deployment.serviceName}@${context.environmentName}.`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "execution-job",
      resourceId: jobId,
      resourceLabel: `${deployment.serviceName}@${context.environmentName}`,
      detail: reason ?? `${action} for ${deployment.serviceName}@${context.environmentName}.`
    }
  });

  if (newStatus === "deploy") {
    await db.insert(events).values({
      kind: "execution.job.dispatched",
      resourceType: "deployment",
      resourceId: jobId,
      summary: "Execution worker accepted the deployment.",
      detail: `${deployment.serviceName} moved from the control plane queue to the worker.`,
      severity: "info",
      metadata: {
        serviceName: deployment.serviceName,
        actorLabel: "docker-ssh-worker"
      },
      createdAt: now
    });
  }

  if (newStatus === "completed") {
    await db.insert(deploymentLogs).values({
      deploymentId: jobId,
      level: "info",
      message: `${deployment.serviceName} reported healthy in ${context.environmentName}.`,
      source: "runtime",
      createdAt: now
    });

    await db.insert(events).values({
      kind: "deployment.succeeded",
      resourceType: "deployment",
      resourceId: jobId,
      summary: "Deployment reached a healthy state.",
      detail: `${deployment.serviceName} reported healthy in ${context.environmentName}.`,
      severity: "info",
      metadata: {
        serviceName: deployment.serviceName,
        actorLabel: "docker-ssh-worker"
      },
      createdAt: now
    });
  }

  if (newStatus === "failed") {
    await db.insert(deploymentLogs).values({
      deploymentId: jobId,
      level: "error",
      message:
        reason ??
        `${deployment.serviceName} failed in ${context.environmentName} during worker handoff.`,
      source: "runtime",
      createdAt: now
    });

    await db.insert(events).values({
      kind: "deployment.failed",
      resourceType: "deployment",
      resourceId: jobId,
      summary: "Deployment failed in the execution worker.",
      detail:
        reason ??
        `${deployment.serviceName} failed in ${context.environmentName} during worker handoff.`,
      severity: "error",
      metadata: {
        serviceName: deployment.serviceName,
        actorLabel: "docker-ssh-worker"
      },
      createdAt: now
    });
  }

  const [updated] = await db.select().from(deployments).where(eq(deployments.id, jobId));
  return { status: "ok" as const, job: updated };
}

export function dispatchExecutionJob(jobId: string, userId: string, email: string, role: AppRole) {
  return mutateDeploymentStatus(jobId, "deploy", userId, email, role, "execution.dispatch");
}

export function completeExecutionJob(jobId: string, userId: string, email: string, role: AppRole) {
  return mutateDeploymentStatus(jobId, "completed", userId, email, role, "execution.complete");
}

export function failExecutionJob(
  jobId: string,
  userId: string,
  email: string,
  role: AppRole,
  reason?: string
) {
  return mutateDeploymentStatus(jobId, "failed", userId, email, role, "execution.fail", reason);
}
