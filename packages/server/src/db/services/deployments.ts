import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { deploymentLogs, deployments, deploymentSteps } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import {
  DeploymentConclusion,
  DeploymentHealthStatus,
  DeploymentLifecycleStatus,
  normalizeDeploymentStatus,
  type AppRole
} from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import {
  readDeploymentCancellationSnapshot,
  writeDeploymentCancellationSnapshot
} from "../../deployment-cancellation";
import { getDeploymentRecord } from "./deployment-queries";
import {
  consumeDeploymentQueueReservation,
  countDeploymentQueueOccupancyForServer,
  DeploymentQueueFullError,
  DeploymentQueueReservationUnavailableError,
  lockTargetServerForDeploymentCapacity
} from "./deployment-capacity";

export type DeploymentStatus = DeploymentLifecycleStatus;
export type DeploymentSourceType = "compose" | "dockerfile" | "image";
export type DeploymentTrigger = (typeof deployments.$inferSelect)["trigger"];
export { getDeploymentRecord, listDeploymentRecords } from "./deployment-queries";
export {
  listDeploymentInsights,
  listDeploymentRollbackPlans
} from "./deployment-diagnostic-queries";
export { listDeploymentLogs } from "./deployment-log-queries";
export type { DeploymentLogStream, ListDeploymentLogsInput } from "./deployment-log-queries";
export interface CreateDeploymentInput {
  deploymentId?: string;
  queueReservationId?: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  sourceType: DeploymentSourceType;
  targetServerId: string;
  commitSha: string;
  imageTag: string;
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | null;
  commandAuditAttemptId?: string;
  teamId: string;
  trigger?: DeploymentTrigger;
  steps: readonly { label: string; detail: string }[];
  configSnapshot?: Record<string, unknown>;
  envVarsEncrypted?: string | null;
}

export async function createDeploymentRecord(input: CreateDeploymentInput) {
  const deploymentId = input.deploymentId ?? id();
  if (input.queueReservationId && input.queueReservationId !== deploymentId) {
    throw new Error("Deployment queue reservations must use the deployment ID as their key.");
  }
  const now = new Date();
  const queuedDeployment = await db.transaction(async (tx) => {
    const server = await lockTargetServerForDeploymentCapacity(tx, input.targetServerId);
    if (!server) {
      return null;
    }

    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.name, input.projectName))
      .limit(1);
    if (!project) {
      return null;
    }

    const [environment] = await tx
      .select()
      .from(environments)
      .where(
        and(eq(environments.projectId, project.id), eq(environments.name, input.environmentName))
      )
      .limit(1);

    if (!environment || server.teamId !== project.teamId || project.teamId !== input.teamId) {
      return null;
    }

    if (input.queueReservationId) {
      const reservationConsumed = await consumeDeploymentQueueReservation(tx, {
        reservationId: input.queueReservationId,
        serverId: input.targetServerId,
        now
      });
      if (!reservationConsumed) {
        throw new DeploymentQueueReservationUnavailableError(
          input.queueReservationId,
          input.targetServerId
        );
      }
    } else {
      const queueOccupancy = await countDeploymentQueueOccupancyForServer(
        tx,
        input.targetServerId,
        now
      );
      if (queueOccupancy >= server.maxQueuedDeployments) {
        throw new DeploymentQueueFullError({
          serverId: input.targetServerId,
          maxQueuedDeployments: server.maxQueuedDeployments,
          queuedDeploymentCount: queueOccupancy
        });
      }
    }

    await tx.insert(deployments).values({
      id: deploymentId,
      projectId: project.id,
      environmentId: environment.id,
      targetServerId: input.targetServerId,
      serviceName: input.serviceName,
      sourceType: input.sourceType,
      commitSha: input.commitSha,
      imageTag: input.imageTag,
      configSnapshot: {
        projectName: input.projectName,
        environmentName: input.environmentName,
        targetServerName: server.name,
        targetServerHost: server.host,
        targetServerKind: server.kind,
        queueName: "docker-ssh",
        workerHint: `ssh://${server.name}/${server.kind}`,
        ...(input.configSnapshot ?? {}),
        ...(input.commandAuditAttemptId
          ? { commandAuditAttemptId: input.commandAuditAttemptId }
          : {})
      },
      envVarsEncrypted: input.envVarsEncrypted ?? null,
      status: "queued",
      trigger: input.trigger ?? "user",
      requestedByUserId: input.requestedByUserId ?? null,
      requestedByEmail: input.requestedByEmail ?? null,
      requestedByRole: input.requestedByRole ?? null,
      updatedAt: now
    });

    return { environment, project, server };
  });

  if (!queuedDeployment) {
    return null;
  }

  const actorType = input.requestedByUserId ? "user" : "system";
  const actorId =
    input.requestedByUserId ??
    (input.trigger === "webhook"
      ? `webhook:${input.requestedByEmail ?? "unknown"}`
      : "system:deployment");

  await db.insert(deploymentSteps).values(
    input.steps.map((step, index) => ({
      deploymentId,
      label: step.label,
      detail: step.detail,
      status: "completed" as const,
      completedAt: now,
      // Reserve negative sort orders for control-plane presteps so worker execution
      // steps can start at 1 without colliding or reordering the visible timeline.
      sortOrder: index - input.steps.length
    }))
  );

  await db.insert(auditEntries).values({
    actorType,
    actorId,
    actorEmail: input.requestedByEmail ?? null,
    actorRole: input.requestedByRole ?? null,
    targetResource: `deployment/${deploymentId}`,
    action: "deployment.create",
    inputSummary: `Queued ${input.serviceName} for ${input.environmentName}.`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: deploymentId,
      resourceLabel: `${input.serviceName}@${input.environmentName}`,
      detail: `Queued ${input.serviceName} for ${input.environmentName}.`
    }
  });

  await db.insert(deploymentLogs).values({
    deploymentId,
    level: "info",
    message: `Control plane queued ${input.serviceName} for ${input.environmentName} using ${input.sourceType} inputs.`,
    source: "system",
    createdAt: now
  });

  await db.insert(events).values({
    kind: "execution.job.created",
    resourceType: "deployment",
    resourceId: deploymentId,
    summary: "Deployment record queued.",
    detail: `${input.serviceName} is waiting in the docker-ssh handoff queue.`,
    severity: "info",
    metadata: {
      serviceName: input.serviceName,
      actorLabel: "control-plane"
    },
    createdAt: now
  });

  return getDeploymentRecord(deploymentId);
}
// ─── Cancel deployment ──────────────────────────────────────

export interface CancelDeploymentInput {
  deploymentId: string;
  teamId: string;
  cancelledByUserId: string;
  cancelledByEmail: string;
  cancelledByRole: AppRole;
}

export async function cancelDeployment(input: CancelDeploymentInput) {
  const [row] = await db
    .select({ deployment: deployments })
    .from(deployments)
    .innerJoin(projects, eq(projects.id, deployments.projectId))
    .where(and(eq(deployments.id, input.deploymentId), eq(projects.teamId, input.teamId)))
    .limit(1);
  const deployment = row?.deployment;

  if (!deployment) return { status: "not-found" as const };

  const currentStatus = normalizeDeploymentStatus(deployment.status, deployment.conclusion);
  if (
    currentStatus !== DeploymentHealthStatus.Queued &&
    currentStatus !== DeploymentHealthStatus.Running
  ) {
    return { status: "invalid-state" as const, currentStatus };
  }

  const existingCancellation = readDeploymentCancellationSnapshot(deployment.configSnapshot);
  if (existingCancellation) {
    return {
      status: "cancellation-requested" as const,
      deploymentId: input.deploymentId
    };
  }

  const now = new Date();
  const cancellationSnapshot = writeDeploymentCancellationSnapshot(deployment.configSnapshot, {
    cancelRequestedAt: now.toISOString(),
    cancelRequestedBy: input.cancelledByEmail,
    cancelRequestedByUserId: input.cancelledByUserId,
    cancelRequestedByRole: input.cancelledByRole
  });

  if (currentStatus === DeploymentHealthStatus.Queued) {
    await db
      .update(deployments)
      .set({
        status: DeploymentLifecycleStatus.Failed,
        conclusion: DeploymentConclusion.Cancelled,
        error: { reason: "Cancelled by user", cancelledBy: input.cancelledByEmail },
        configSnapshot: cancellationSnapshot,
        concludedAt: now,
        updatedAt: now
      })
      .where(eq(deployments.id, input.deploymentId));
  } else {
    await db
      .update(deployments)
      .set({
        configSnapshot: cancellationSnapshot,
        updatedAt: now
      })
      .where(eq(deployments.id, input.deploymentId));

    await db.insert(deploymentLogs).values({
      deploymentId: input.deploymentId,
      level: "warn",
      message: `Cancellation requested by ${input.cancelledByEmail}.`,
      source: "system",
      createdAt: now
    });
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.cancelledByUserId,
    actorEmail: input.cancelledByEmail,
    actorRole: input.cancelledByRole,
    targetResource: `deployment/${input.deploymentId}`,
    action: "deployment.cancel",
    inputSummary:
      currentStatus === DeploymentHealthStatus.Queued
        ? `Cancelled deployment ${input.deploymentId}.`
        : `Requested cancellation for deployment ${input.deploymentId}.`,
    permissionScope: "deploy:cancel",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: input.deploymentId,
      detail:
        currentStatus === DeploymentHealthStatus.Queued
          ? `Cancelled deployment from ${currentStatus} state.`
          : `Requested cancellation for deployment from ${currentStatus} state.`
    }
  });

  await db.insert(events).values({
    kind:
      currentStatus === DeploymentHealthStatus.Queued
        ? "deployment.cancelled"
        : "deployment.cancel.requested",
    resourceType: "deployment",
    resourceId: input.deploymentId,
    summary:
      currentStatus === DeploymentHealthStatus.Queued
        ? "Deployment cancelled by user."
        : "Deployment cancellation requested by user.",
    detail:
      currentStatus === DeploymentHealthStatus.Queued
        ? `${input.cancelledByEmail} cancelled a ${currentStatus} deployment.`
        : `${input.cancelledByEmail} requested cancellation for a ${currentStatus} deployment.`,
    severity: "warning",
    metadata: { previousStatus: currentStatus, cancelledBy: input.cancelledByEmail },
    createdAt: now
  });

  return {
    status:
      currentStatus === DeploymentHealthStatus.Queued
        ? ("cancelled" as const)
        : ("cancellation-requested" as const),
    deploymentId: input.deploymentId
  };
}
